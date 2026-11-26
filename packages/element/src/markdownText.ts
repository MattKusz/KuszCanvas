/**
 * KuszCanvas: pure Markdown parser for text elements.
 *
 * Parses the inline and line-block Markdown subset that text elements render
 * on canvas: `**`/`__` bold, `*`/`_` italic, `~~` strike, `==` highlight,
 * `<u>…</u>` underline, `` ` `` code and `\` escapes; and per line
 * `-`/`*`/`+` bullets, `1.`/`1)` ordered items, `>` quotes and GFM tables.
 * Headings, horizontal rules, fenced code and Obsidian `#tags` render
 * literally (Obsidian indexes tags itself).
 *
 * Every character of a parsed string belongs to exactly one run; markers the
 * parser consumes are `hidden` runs, so callers can map source offsets to
 * rendered text. Unmatched markers stay visible.
 *
 * No fonts, measuring or DOM here -- see `markdownTextLayout.ts`.
 */

export type MarkdownInlineStyle = Readonly<{
  bold: boolean;
  italic: boolean;
  strike: boolean;
  underline: boolean;
  highlight: boolean;
  code: boolean;
}>;

/** A stretch of a parsed string with one style. Offsets are code units. */
export type MarkdownRun = Readonly<{
  text: string;
  start: number;
  end: number;
  /** a consumed marker: takes no space and is not drawn */
  hidden: boolean;
  style: MarkdownInlineStyle;
}>;

/** A task list item's checkbox: `[ ]` open, `[x]` done; `null` = no checkbox. */
export type MarkdownTask = "open" | "done" | null;

export type MarkdownListMarker = Readonly<
  | { kind: "bullet"; task: MarkdownTask }
  | { kind: "ordered"; label: string; task: MarkdownTask }
>;

export type MarkdownTableAlign = "left" | "center" | "right";

export type MarkdownTableCell = Readonly<{
  /** offsets into the line */
  start: number;
  end: number;
  /** offsets into the line */
  runs: readonly MarkdownRun[];
}>;

export type MarkdownTableRow = Readonly<{
  tableId: number;
  /** index among the table's lines, delimiter included */
  rowIndex: number;
  isHeader: boolean;
  isDelimiter: boolean;
  cells: readonly MarkdownTableCell[];
  align: readonly MarkdownTableAlign[];
}>;

export type MarkdownLine = Readonly<{
  kind: "blank" | "text" | "table";
  quoteDepth: number;
  /** 0 outside a list; 1 for a top-level item and its continuation lines */
  listLevel: number;
  /** only on the first line of a list item */
  marker: MarkdownListMarker | null;
  /** where the drawn content starts, after indentation and markers */
  contentStart: number;
  /** offsets into the line; cover `[contentStart, line.length)` */
  runs: readonly MarkdownRun[];
  table: MarkdownTableRow | null;
}>;

export type ParseMarkdownTextOptions = Readonly<{
  /**
   * One flag per line: `true` marks a line as the wrapped tail of the line
   * before it (from `alignWrappedLines`), so it never starts a block.
   */
  continuation?: readonly boolean[];
}>;

const BOLD = 1;
const ITALIC = 2;
const STRIKE = 4;
const UNDERLINE = 8;
const HIGHLIGHT = 16;
const CODE = 32;

const styleCache = new Map<number, MarkdownInlineStyle>();
const styleFromFlags = (flags: number): MarkdownInlineStyle => {
  let style = styleCache.get(flags);
  if (!style) {
    style = Object.freeze({
      bold: (flags & BOLD) !== 0,
      italic: (flags & ITALIC) !== 0,
      strike: (flags & STRIKE) !== 0,
      underline: (flags & UNDERLINE) !== 0,
      highlight: (flags & HIGHLIGHT) !== 0,
      code: (flags & CODE) !== 0,
    });
    styleCache.set(flags, style);
  }
  return style;
};

export const PLAIN_MARKDOWN_STYLE = styleFromFlags(0);

const withStrike = (style: MarkdownInlineStyle): MarkdownInlineStyle =>
  styleFromFlags(
    (style.bold ? BOLD : 0) |
      (style.italic ? ITALIC : 0) |
      STRIKE |
      (style.underline ? UNDERLINE : 0) |
      (style.highlight ? HIGHLIGHT : 0) |
      (style.code ? CODE : 0),
  );

const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;
const WHITESPACE = /\s/;

type Delimiter = {
  char: "*" | "_" | "~" | "=" | "u";
  /** first code unit of the run */
  start: number;
  /** code units in the run (for `u`, the tag length) */
  length: number;
  /** unconsumed code units, consumed from the inside out */
  remaining: number;
  /** code units consumed from the run's start (closers) */
  consumedFromStart: number;
  canOpen: boolean;
  canClose: boolean;
  active: boolean;
};

const isWhitespaceChar = (char: string | undefined) =>
  char === undefined || WHITESPACE.test(char);
const isPunctuationChar = (char: string | undefined) =>
  char !== undefined && ASCII_PUNCTUATION.test(char);

const countRun = (text: string, index: number, char: string) => {
  let end = index;
  while (text[end] === char) {
    end++;
  }
  return end - index;
};

/**
 * Parses inline Markdown in `text` (which may span several lines of one
 * paragraph) into runs that cover every character once.
 */
export const parseMarkdownInline = (text: string): MarkdownRun[] => {
  if (typeof text !== "string") {
    throw new Error("parseMarkdownInline: text must be a string");
  }
  const length = text.length;
  const flags = new Uint8Array(length);
  const hidden = new Uint8Array(length);
  const delimiters: Delimiter[] = [];

  // 1. tokenise: code spans, escapes, `<u>` tags and delimiter runs
  let i = 0;
  while (i < length) {
    const char = text[i];

    if (char === "\\" && i + 1 < length && isPunctuationChar(text[i + 1])) {
      hidden[i] = 1;
      i += 2;
      continue;
    }

    if (char === "`") {
      const runLength = countRun(text, i, "`");
      let search = i + runLength;
      let closeAt = -1;
      while (search < length) {
        const next = text.indexOf("`", search);
        if (next === -1) {
          break;
        }
        const closeLength = countRun(text, next, "`");
        if (closeLength === runLength) {
          closeAt = next;
          break;
        }
        search = next + closeLength;
      }
      if (closeAt === -1) {
        i += runLength;
        continue;
      }
      for (let k = i; k < i + runLength; k++) {
        hidden[k] = 1;
      }
      for (let k = i + runLength; k < closeAt; k++) {
        flags[k] |= CODE;
      }
      for (let k = closeAt; k < closeAt + runLength; k++) {
        hidden[k] = 1;
      }
      i = closeAt + runLength;
      continue;
    }

    if (char === "<") {
      const lower = text.slice(i, i + 4).toLowerCase();
      if (lower.startsWith("<u>")) {
        delimiters.push({
          char: "u",
          start: i,
          length: 3,
          remaining: 3,
          consumedFromStart: 0,
          canOpen: true,
          canClose: false,
          active: true,
        });
        i += 3;
        continue;
      }
      if (lower === "</u>") {
        delimiters.push({
          char: "u",
          start: i,
          length: 4,
          remaining: 4,
          consumedFromStart: 0,
          canOpen: false,
          canClose: true,
          active: true,
        });
        i += 4;
        continue;
      }
    }

    if (char === "*" || char === "_" || char === "~" || char === "=") {
      const runLength = countRun(text, i, char);
      const before = text[i - 1];
      const after = text[i + runLength];
      const leftFlanking =
        !isWhitespaceChar(after) &&
        (!isPunctuationChar(after) ||
          isWhitespaceChar(before) ||
          isPunctuationChar(before));
      const rightFlanking =
        !isWhitespaceChar(before) &&
        (!isPunctuationChar(before) ||
          isWhitespaceChar(after) ||
          isPunctuationChar(after));
      const isPairOnly = char === "~" || char === "=";
      if (!isPairOnly || runLength === 2) {
        delimiters.push({
          char,
          start: i,
          length: runLength,
          remaining: runLength,
          consumedFromStart: 0,
          canOpen:
            char === "_"
              ? leftFlanking && (!rightFlanking || isPunctuationChar(before))
              : leftFlanking,
          canClose:
            char === "_"
              ? rightFlanking && (!leftFlanking || isPunctuationChar(after))
              : rightFlanking,
          active: true,
        });
      }
      i += runLength;
      continue;
    }

    i++;
  }

  // 2. match closers to the nearest compatible opener (CommonMark-style)
  const applyRange = (from: number, to: number, flag: number) => {
    for (let k = from; k < to; k++) {
      flags[k] |= flag;
    }
  };
  for (let c = 0; c < delimiters.length; c++) {
    const closer = delimiters[c];
    if (!closer.canClose) {
      continue;
    }
    while (closer.active && closer.remaining > 0) {
      let o = c - 1;
      for (; o >= 0; o--) {
        const opener = delimiters[o];
        if (
          opener.active &&
          opener.canOpen &&
          opener.remaining > 0 &&
          opener.char === closer.char
        ) {
          break;
        }
      }
      if (o < 0) {
        break;
      }
      const opener = delimiters[o];
      let use: number;
      let flag: number;
      if (closer.char === "*" || closer.char === "_") {
        use = opener.remaining >= 2 && closer.remaining >= 2 ? 2 : 1;
        flag = use === 2 ? BOLD : ITALIC;
      } else {
        use = opener.remaining;
        flag =
          closer.char === "~"
            ? STRIKE
            : closer.char === "="
            ? HIGHLIGHT
            : UNDERLINE;
        if (closer.remaining !== (closer.char === "u" ? 4 : 2)) {
          break;
        }
      }
      // opener: consume its innermost (last) remaining code units
      const openerConsumeEnd = opener.start + opener.remaining;
      const openerConsumeStart = openerConsumeEnd - use;
      const closerUse = closer.char === "u" ? closer.remaining : use;
      const closerConsumeStart = closer.start + closer.consumedFromStart;
      const closerConsumeEnd = closerConsumeStart + closerUse;
      for (let k = openerConsumeStart; k < openerConsumeEnd; k++) {
        hidden[k] = 1;
      }
      for (let k = closerConsumeStart; k < closerConsumeEnd; k++) {
        hidden[k] = 1;
      }
      applyRange(openerConsumeEnd, closerConsumeStart, flag);
      opener.remaining -= use;
      closer.remaining -= closerUse;
      closer.consumedFromStart += closerUse;
      // delimiters between a matched pair can no longer match
      for (let k = o + 1; k < c; k++) {
        delimiters[k].active = false;
      }
      if (opener.remaining === 0) {
        opener.active = false;
      }
    }
    if (closer.remaining === 0) {
      closer.active = false;
    }
  }

  // 3. group characters with equal style into runs
  const runs: MarkdownRun[] = [];
  let runStart = 0;
  for (let k = 1; k <= length; k++) {
    if (
      k === length ||
      hidden[k] !== hidden[runStart] ||
      flags[k] !== flags[runStart]
    ) {
      runs.push({
        text: text.slice(runStart, k),
        start: runStart,
        end: k,
        hidden: hidden[runStart] === 1,
        style: styleFromFlags(flags[runStart]),
      });
      runStart = k;
    }
  }
  return runs;
};

/** Shifts runs by `offset` and clips them to `[from, to)`. */
const sliceRuns = (
  runs: readonly MarkdownRun[],
  from: number,
  to: number,
  offset: number,
): MarkdownRun[] => {
  const result: MarkdownRun[] = [];
  for (const run of runs) {
    const start = Math.max(run.start, from);
    const end = Math.min(run.end, to);
    if (end <= start) {
      continue;
    }
    result.push({
      text: run.text.slice(start - run.start, end - run.start),
      start: start + offset,
      end: end + offset,
      hidden: run.hidden,
      style: run.style,
    });
  }
  return result;
};

const BLANK_LINE = /^\s*$/;
const QUOTE_PREFIX = /^ {0,3}>[ ]?/;
const BULLET_ITEM = /^(\s*)([-*+])(\s+)/;
const ORDERED_ITEM = /^(\s*)(\d{1,9}[.)])(\s+)/;
// GFM task checkbox right after a list marker: `[ ]`, `[x]` or `[X]`
const TASK_CHECKBOX = /^\[([ xX])\](?:\s+|$)/;
const HEADING = /^ {0,3}#{1,6}(\s|$)/;
const FENCE = /^ {0,3}(```|~~~)/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** splits a table line on unescaped pipes; offsets into the line */
const splitTableCells = (line: string) => {
  const cells: { start: number; end: number }[] = [];
  let start = 0;
  for (let k = 0; k <= line.length; k++) {
    if (k === line.length || (line[k] === "|" && line[k - 1] !== "\\")) {
      cells.push({ start, end: k });
      start = k + 1;
    }
  }
  // drop the empty cells outside leading and trailing pipes
  if (cells.length > 1 && BLANK_LINE.test(line.slice(0, cells[0].end))) {
    cells.shift();
  }
  if (
    cells.length > 1 &&
    BLANK_LINE.test(line.slice(cells[cells.length - 1].start))
  ) {
    cells.pop();
  }
  // trim whitespace inside each cell
  return cells.map(({ start, end }) => {
    let s = start;
    let e = end;
    while (s < e && WHITESPACE.test(line[s])) {
      s++;
    }
    while (e > s && WHITESPACE.test(line[e - 1])) {
      e--;
    }
    return { start: s, end: e };
  });
};

const hasUnescapedPipe = (line: string) => /(^|[^\\])\|/.test(line);

const parseTableAlign = (line: string): MarkdownTableAlign[] =>
  splitTableCells(line).map(({ start, end }) => {
    const cell = line.slice(start, end);
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    return left && right ? "center" : right ? "right" : "left";
  });

type Block = {
  quoteDepth: number;
  listLevel: number;
  marker: MarkdownListMarker | null;
  contentStart: number;
};

/** quote depth and the offset after the quote markers */
const readQuotePrefix = (line: string) => {
  let depth = 0;
  let offset = 0;
  for (;;) {
    const match = QUOTE_PREFIX.exec(line.slice(offset));
    if (!match) {
      return { depth, offset };
    }
    depth++;
    offset += match[0].length;
  }
};

/**
 * Parses `text` into one `MarkdownLine` per `\n`-separated line. Inline
 * styles carry across the lines of one paragraph or list item and stop at a
 * blank line or a new block.
 */
export const parseMarkdownText = (
  text: string,
  options: ParseMarkdownTextOptions = {},
): MarkdownLine[] => {
  if (typeof text !== "string") {
    throw new Error("parseMarkdownText: text must be a string");
  }
  const sourceLines = text.split("\n");
  const continuation = options.continuation;
  if (continuation !== undefined) {
    if (
      !Array.isArray(continuation) ||
      continuation.length !== sourceLines.length
    ) {
      throw new Error(
        "parseMarkdownText: continuation must have one flag per line",
      );
    }
  }

  const blocks: (Block & { kind: MarkdownLine["kind"]; literal: boolean })[] =
    [];
  const tables: (MarkdownTableRow | null)[] = new Array(
    sourceLines.length,
  ).fill(null);
  /** paragraph groups: line indexes whose content is parsed together */
  const groupOf: number[] = new Array(sourceLines.length).fill(-1);
  let groupCount = 0;
  /** whether the previous line's group can take a lazy continuation */
  let openGroup = -1;
  let inFence = false;
  let listStack: number[] = [];
  let tableId = 0;
  let tableAlign: MarkdownTableAlign[] = [];
  let tableRowIndex = -1;

  for (let index = 0; index < sourceLines.length; index++) {
    const line = sourceLines[index];
    const previous = blocks[index - 1];
    const isForcedContinuation = continuation?.[index] === true && !!previous;

    // a wrapped tail of the previous line: same block, same paragraph
    if (isForcedContinuation) {
      const leading = /^\s*/.exec(line)![0].length;
      const inheritsBlock = previous.kind === "text";
      blocks.push({
        kind: "text",
        literal: previous.literal,
        quoteDepth: inheritsBlock ? previous.quoteDepth : 0,
        listLevel: inheritsBlock ? previous.listLevel : 0,
        marker: null,
        contentStart: leading,
      });
      if (inheritsBlock && !previous.literal && openGroup !== -1) {
        groupOf[index] = openGroup;
      } else if (!previous.literal) {
        groupOf[index] = groupCount++;
        openGroup = groupOf[index];
      }
      continue;
    }

    // fenced code: literal until the closing fence
    if (inFence || FENCE.test(line)) {
      if (FENCE.test(line)) {
        inFence = !inFence;
      }
      blocks.push({
        kind: "text",
        literal: true,
        quoteDepth: 0,
        listLevel: 0,
        marker: null,
        contentStart: 0,
      });
      openGroup = -1;
      listStack = [];
      continue;
    }

    if (BLANK_LINE.test(line)) {
      blocks.push({
        kind: "blank",
        literal: false,
        quoteDepth: 0,
        listLevel: 0,
        marker: null,
        contentStart: 0,
      });
      openGroup = -1;
      tableRowIndex = -1;
      continue;
    }

    // tables: a header row followed by a delimiter row, then pipe rows
    const isTableContinuation =
      tableRowIndex >= 0 &&
      hasUnescapedPipe(line) &&
      continuation?.[index] !== true;
    const startsTable =
      !isTableContinuation &&
      hasUnescapedPipe(line) &&
      index + 1 < sourceLines.length &&
      continuation?.[index + 1] !== true &&
      TABLE_DELIMITER.test(sourceLines[index + 1]) &&
      sourceLines[index + 1].includes("-") &&
      splitTableCells(sourceLines[index + 1]).length ===
        splitTableCells(line).length;
    if (startsTable || isTableContinuation) {
      if (startsTable) {
        tableId++;
        tableAlign = parseTableAlign(sourceLines[index + 1]);
        tableRowIndex = 0;
      } else {
        tableRowIndex++;
      }
      const isDelimiter = tableRowIndex === 1;
      const cells = isDelimiter
        ? []
        : splitTableCells(line).map(({ start, end }) => ({
            start,
            end,
            runs: sliceRuns(
              parseMarkdownInline(line.slice(start, end)),
              0,
              end - start,
              start,
            ),
          }));
      tables[index] = {
        tableId,
        rowIndex: tableRowIndex,
        isHeader: tableRowIndex === 0,
        isDelimiter,
        cells,
        align: tableAlign,
      };
      blocks.push({
        kind: "table",
        literal: false,
        quoteDepth: 0,
        listLevel: 0,
        marker: null,
        contentStart: 0,
      });
      openGroup = -1;
      listStack = [];
      continue;
    }
    tableRowIndex = -1;

    const quote = readQuotePrefix(line);
    const afterQuote = line.slice(quote.offset);
    const bullet = BULLET_ITEM.exec(afterQuote);
    const ordered = bullet ? null : ORDERED_ITEM.exec(afterQuote);
    const listMatch = bullet ?? ordered;

    // a plain line after a paragraph, item or quote continues it lazily
    if (
      !listMatch &&
      quote.depth === 0 &&
      !HEADING.test(line) &&
      openGroup !== -1 &&
      previous
    ) {
      // inside an item or quote the hanging indent replaces indentation;
      // in a plain paragraph it stays visible, as in the raw text
      const leading =
        previous.listLevel > 0 || previous.quoteDepth > 0
          ? /^\s*/.exec(line)![0].length
          : 0;
      blocks.push({
        kind: "text",
        literal: false,
        quoteDepth: previous.quoteDepth,
        listLevel: previous.listLevel,
        marker: null,
        contentStart: leading,
      });
      groupOf[index] = openGroup;
      continue;
    }

    if (listMatch) {
      const indent = listMatch[1].length;
      while (listStack.length && listStack[listStack.length - 1] > indent) {
        listStack.pop();
      }
      if (!listStack.length || listStack[listStack.length - 1] < indent) {
        listStack.push(indent);
      }
      const markerEnd = quote.offset + listMatch[0].length;
      const checkbox = TASK_CHECKBOX.exec(line.slice(markerEnd));
      const task: MarkdownTask = checkbox
        ? checkbox[1] === " "
          ? "open"
          : "done"
        : null;
      blocks.push({
        kind: "text",
        literal: false,
        quoteDepth: quote.depth,
        listLevel: listStack.length,
        marker: bullet
          ? { kind: "bullet", task }
          : { kind: "ordered", label: ordered![2], task },
        contentStart: markerEnd + (checkbox ? checkbox[0].length : 0),
      });
      groupOf[index] = groupCount++;
      openGroup = groupOf[index];
      continue;
    }

    listStack = [];
    // a quote line continues the previous quote paragraph at the same depth
    const continuesQuote =
      quote.depth > 0 &&
      openGroup !== -1 &&
      previous?.quoteDepth === quote.depth &&
      previous.listLevel === 0;
    blocks.push({
      kind: "text",
      literal: false,
      quoteDepth: quote.depth,
      listLevel: 0,
      marker: null,
      contentStart: quote.offset,
    });
    if (continuesQuote) {
      groupOf[index] = openGroup;
    } else {
      groupOf[index] = groupCount++;
      openGroup = HEADING.test(line) ? -1 : groupOf[index];
    }
  }

  // parse each paragraph group as one string so spans may cross lines
  const lineRuns: MarkdownRun[][] = sourceLines.map(() => []);
  const groups = new Map<number, number[]>();
  groupOf.forEach((group, index) => {
    if (group !== -1) {
      const members = groups.get(group);
      if (members) {
        members.push(index);
      } else {
        groups.set(group, [index]);
      }
    }
  });
  for (const members of groups.values()) {
    const contents = members.map((index) =>
      sourceLines[index].slice(blocks[index].contentStart),
    );
    let runs = parseMarkdownInline(contents.join("\n"));
    // a done task is struck through, as in Obsidian's default theme
    if (blocks[members[0]].marker?.task === "done") {
      runs = runs.map((run) => ({ ...run, style: withStrike(run.style) }));
    }
    let offset = 0;
    members.forEach((index, k) => {
      const contentLength = contents[k].length;
      lineRuns[index] = sliceRuns(
        runs,
        offset,
        offset + contentLength,
        blocks[index].contentStart - offset,
      );
      offset += contentLength + 1;
    });
  }

  return sourceLines.map((line, index) => {
    const block = blocks[index];
    const runs =
      block.kind === "text" && (block.literal || groupOf[index] === -1)
        ? line.length > block.contentStart
          ? [
              {
                text: line.slice(block.contentStart),
                start: block.contentStart,
                end: line.length,
                hidden: false,
                style: PLAIN_MARKDOWN_STYLE,
              },
            ]
          : []
        : lineRuns[index];
    return {
      kind: block.kind,
      quoteDepth: block.quoteDepth,
      listLevel: block.listLevel,
      marker: block.marker,
      contentStart: block.contentStart,
      runs,
      table: tables[index],
    };
  });
};

// any character or line start that could begin Markdown this parser renders
const MARKDOWN_SYNTAX_HINT = /[*_~=`\\<|>]|^\s*(?:[-+]|\d{1,9}[.)])\s/m;

/** Cheap pre-check: `false` means the text certainly renders as plain text. */
export const hasMarkdownSyntax = (text: string): boolean => {
  if (typeof text !== "string") {
    throw new Error("hasMarkdownSyntax: text must be a string");
  }
  return MARKDOWN_SYNTAX_HINT.test(text);
};

/** Whether parsed lines render exactly like the raw text. */
export const isPlainMarkdown = (lines: readonly MarkdownLine[]): boolean =>
  lines.every(
    (line) =>
      line.table === null &&
      line.quoteDepth === 0 &&
      line.listLevel === 0 &&
      line.marker === null &&
      line.contentStart === 0 &&
      line.runs.every(
        (run) => !run.hidden && run.style === PLAIN_MARKDOWN_STYLE,
      ),
  );
