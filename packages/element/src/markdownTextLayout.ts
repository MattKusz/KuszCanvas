/**
 * KuszCanvas: Markdown text layout -- shared by measuring, wrapping and both
 * renderers (canvas and SVG), so a text element's size always matches what
 * is drawn.
 *
 * Pure given a `measure` function; no DOM, canvas or host access.
 */
import { isRTL } from "@excalidraw/common";

import {
  hasMarkdownSyntax,
  isPlainMarkdown,
  parseMarkdownText,
} from "./markdownText";
import { parseTokens } from "./textWrapping";

import type {
  MarkdownInlineStyle,
  MarkdownLine,
  MarkdownRun,
  MarkdownTableAlign,
} from "./markdownText";
import type { WrappedTextLine } from "./textWrapping";
import type { FontString } from "./types";

/** Measures the advance width of `text` drawn in `font`. */
export type MarkdownMeasure = (text: string, font: FontString) => number;

/** Code spans: a system monospace stack, always available synchronously. */
export const MARKDOWN_CODE_FONT_FAMILY = `"Cascadia Mono", Consolas, "SF Mono", Menlo, monospace`;

/** Layout metrics in em (multiples of the element's font size). */
export const MARKDOWN_TEXT_METRICS = Object.freeze({
  listIndent: 1.4,
  quoteIndent: 0.9,
  quoteBarWidth: 0.12,
  quoteBarOffset: 0.15,
  bulletOffset: 0.55,
  bulletRadius: 0.13,
  orderedGap: 0.35,
  codePadding: 0.2,
  tableCellPadding: 0.5,
});

export type MarkdownSegment = Readonly<{
  text: string;
  /** box start, relative to the line origin */
  x: number;
  /** box width, padding included */
  width: number;
  /** where the text is drawn, relative to the line origin */
  textX: number;
  textWidth: number;
  style: MarkdownInlineStyle;
  font: FontString;
}>;

export type MarkdownBullet = Readonly<
  | { kind: "dot"; cx: number }
  | { kind: "label"; text: string; x: number; width: number }
>;

export type MarkdownTableLine = Readonly<{
  columnXs: readonly number[];
  columnWidths: readonly number[];
  width: number;
  isHeader: boolean;
  isDelimiter: boolean;
  isLastRow: boolean;
}>;

export type MarkdownVisualLine = Readonly<{
  /** in line heights from the element's top */
  top: number;
  /** in line heights; table rows share the delimiter line, which gets 0 */
  height: number;
  /** total drawn width, indentation included */
  width: number;
  segments: readonly MarkdownSegment[];
  bullet: MarkdownBullet | null;
  /** left x of each quote bar */
  quoteBars: readonly number[];
  table: MarkdownTableLine | null;
}>;

export type MarkdownTextLayout = Readonly<{
  lines: readonly MarkdownVisualLine[];
  width: number;
}>;

const FONT_STRING = /^(\d+(?:\.\d+)?)px (.+)$/;

const parseFontString = (font: FontString) => {
  if (typeof font !== "string") {
    throw new Error("Markdown layout: font must be a string");
  }
  const match = FONT_STRING.exec(font);
  if (!match) {
    throw new Error(`Markdown layout: malformed font string "${font}"`);
  }
  return { fontSize: parseFloat(match[1]), family: match[2] };
};

/** The canvas/CSS font for a run of `style` in an element's `font`. */
export const getMarkdownRunFont = (
  font: FontString,
  style: MarkdownInlineStyle,
): FontString => {
  const { fontSize } = parseFontString(font);
  const prefix = `${style.italic ? "italic " : ""}${style.bold ? "bold " : ""}`;
  if (style.code) {
    return `${prefix}${fontSize}px ${MARKDOWN_CODE_FONT_FAMILY}` as FontString;
  }
  return (prefix ? `${prefix}${font}` : font) as FontString;
};

const boldStyles = new WeakMap<MarkdownInlineStyle, MarkdownInlineStyle>();
const withBold = (style: MarkdownInlineStyle): MarkdownInlineStyle => {
  if (style.bold) {
    return style;
  }
  let bold = boldStyles.get(style);
  if (!bold) {
    bold = Object.freeze({ ...style, bold: true });
    boldStyles.set(style, bold);
  }
  return bold;
};

const validateMeasure = (measure: MarkdownMeasure) => {
  if (typeof measure !== "function") {
    throw new Error("Markdown layout: measure must be a function");
  }
};

/**
 * Lays the visible parts of `runs` within `[from, to)` out from `startX`,
 * merging neighbours of equal style so plain text is measured in one call.
 */
const buildSegments = (
  runs: readonly MarkdownRun[],
  from: number,
  to: number,
  font: FontString,
  measure: MarkdownMeasure,
  startX: number,
  forceBold = false,
) => {
  const pieces: { text: string; style: MarkdownInlineStyle }[] = [];
  for (const run of runs) {
    const start = Math.max(run.start, from);
    const end = Math.min(run.end, to);
    if (end <= start || run.hidden) {
      continue;
    }
    const text = run.text.slice(start - run.start, end - run.start);
    const style = forceBold ? withBold(run.style) : run.style;
    const last = pieces[pieces.length - 1];
    if (last && last.style === style) {
      last.text += text;
    } else {
      pieces.push({ text, style });
    }
  }
  const { fontSize } = parseFontString(font);
  let x = startX;
  const segments: MarkdownSegment[] = pieces.map(({ text, style }) => {
    const runFont = getMarkdownRunFont(font, style);
    const padding =
      fontSize * (style.code ? MARKDOWN_TEXT_METRICS.codePadding : 0);
    const textWidth = measure(text, runFont);
    const segment: MarkdownSegment = {
      text,
      x,
      width: textWidth + padding * 2,
      textX: x + padding,
      textWidth,
      style,
      font: runFont,
    };
    x += segment.width;
    return segment;
  });
  return { segments, width: x - startX };
};

type LineGeometry = {
  contentX: number;
  bullet: MarkdownBullet | null;
  quoteBars: number[];
};

/** Indentation, bullet and quote bars of each parsed line. */
const getLineGeometries = (
  lines: readonly MarkdownLine[],
  font: FontString,
  measure: MarkdownMeasure,
): LineGeometry[] => {
  const { fontSize } = parseFontString(font);
  const listIndent = MARKDOWN_TEXT_METRICS.listIndent * fontSize;
  const quoteIndent = MARKDOWN_TEXT_METRICS.quoteIndent * fontSize;
  const gap = MARKDOWN_TEXT_METRICS.orderedGap * fontSize;
  /** content x of the latest item per level, for its continuation lines */
  const itemContentX = new Map<number, number>();

  return lines.map((line) => {
    const quoteX = line.quoteDepth * quoteIndent;
    const quoteBars = Array.from(
      { length: line.quoteDepth },
      (_, depth) =>
        depth * quoteIndent + MARKDOWN_TEXT_METRICS.quoteBarOffset * fontSize,
    );
    if (line.listLevel === 0) {
      return { contentX: quoteX, bullet: null, quoteBars };
    }
    const itemStart = quoteX + (line.listLevel - 1) * listIndent;
    if (!line.marker) {
      return {
        contentX: itemContentX.get(line.listLevel) ?? itemStart + listIndent,
        bullet: null,
        quoteBars,
      };
    }
    let contentX = itemStart + listIndent;
    let bullet: MarkdownBullet;
    if (line.marker.kind === "bullet") {
      bullet = {
        kind: "dot",
        cx: itemStart + MARKDOWN_TEXT_METRICS.bulletOffset * fontSize,
      };
    } else {
      const width = measure(line.marker.label, font);
      contentX = Math.max(contentX, itemStart + width + gap);
      bullet = {
        kind: "label",
        text: line.marker.label,
        x: contentX - gap - width,
        width,
      };
    }
    itemContentX.set(line.listLevel, contentX);
    // deeper levels belong to the previous item
    for (const level of itemContentX.keys()) {
      if (level > line.listLevel) {
        itemContentX.delete(level);
      }
    }
    return { contentX, bullet, quoteBars };
  });
};

const normalizeForAlignment = (text: string) =>
  text.normalize("NFC").replace(/\s+/g, "");

/**
 * Maps the lines of `visualText` (a wrap of `sourceText`) back to the source:
 * `true` marks a visual line that continues the source line before it.
 * Returns `null` if the visual text did not come from the source.
 */
export const alignWrappedLines = (
  sourceText: string,
  visualText: string,
): boolean[] | null => {
  if (typeof sourceText !== "string" || typeof visualText !== "string") {
    throw new Error("alignWrappedLines: texts must be strings");
  }
  const visual = visualText.split("\n");
  const flags: boolean[] = [];
  let v = 0;
  for (const sourceLine of sourceText.split("\n")) {
    if (v >= visual.length) {
      return null;
    }
    const target = normalizeForAlignment(sourceLine);
    let accumulated = normalizeForAlignment(visual[v]);
    flags.push(false);
    v++;
    while (accumulated.length < target.length && v < visual.length) {
      accumulated += normalizeForAlignment(visual[v]);
      flags.push(true);
      v++;
    }
    if (accumulated !== target) {
      return null;
    }
  }
  return v === visual.length ? flags : null;
};

const layoutTables = (
  lines: readonly MarkdownLine[],
  font: FontString,
  measure: MarkdownMeasure,
) => {
  const { fontSize } = parseFontString(font);
  const cellPadding = MARKDOWN_TEXT_METRICS.tableCellPadding * fontSize;
  const result = new Map<number, MarkdownVisualLine>();

  let index = 0;
  while (index < lines.length) {
    const tableStart = index;
    const first = lines[tableStart].table;
    if (!first) {
      index++;
      continue;
    }
    let end = index;
    while (end < lines.length && lines[end].table?.tableId === first.tableId) {
      end++;
    }
    const rows = lines.slice(index, end);
    const columnCount = Math.max(
      first.align.length,
      ...rows.map((line) => line.table!.cells.length),
    );
    const cellLayouts = rows.map((line) =>
      line.table!.cells.map((cell) =>
        buildSegments(
          cell.runs,
          cell.start,
          cell.end,
          font,
          measure,
          0,
          line.table!.isHeader,
        ),
      ),
    );
    const columnWidths = Array.from(
      { length: columnCount },
      (_, column) =>
        Math.max(0, ...cellLayouts.map((cells) => cells[column]?.width ?? 0)) +
        2 * cellPadding,
    );
    const columnXs: number[] = [];
    let tableWidth = 0;
    for (const width of columnWidths) {
      columnXs.push(tableWidth);
      tableWidth += width;
    }

    const lineCount = rows.length;
    const contentRows = Math.max(1, lineCount - 1);
    const rowHeight = lineCount / contentRows;
    rows.forEach((line, k) => {
      const table = line.table!;
      const ordinal = table.rowIndex === 0 ? 0 : table.rowIndex - 1;
      const align = (column: number): MarkdownTableAlign =>
        table.align[column] ?? "left";
      const segments = table.isDelimiter
        ? []
        : cellLayouts[k].flatMap((cell, column) => {
            const columnX = columnXs[column];
            const columnWidth = columnWidths[column];
            const offset =
              align(column) === "right"
                ? columnX + columnWidth - cellPadding - cell.width
                : align(column) === "center"
                ? columnX + (columnWidth - cell.width) / 2
                : columnX + cellPadding;
            return cell.segments.map((segment) => ({
              ...segment,
              x: segment.x + offset,
              textX: segment.textX + offset,
            }));
          });
      result.set(tableStart + k, {
        top: tableStart + (table.isDelimiter ? rowHeight : ordinal * rowHeight),
        height: table.isDelimiter ? 0 : rowHeight,
        width: tableWidth,
        segments,
        bullet: null,
        quoteBars: [],
        table: {
          columnXs,
          columnWidths,
          width: tableWidth,
          isHeader: table.isHeader,
          isDelimiter: table.isDelimiter,
          isLastRow: k === rows.length - 1,
        },
      });
    });
    index = end;
  }
  return result;
};

/**
 * Lays out a text element's (possibly wrapped) `visualText` as Markdown.
 * Pass the unwrapped `sourceText` so wrapped tails are told apart from new
 * blocks. Returns `null` when the text renders exactly like raw text
 * (including right-to-left text, which keeps the plain renderer).
 */
export const layoutMarkdownText = (
  visualText: string,
  font: FontString,
  measure: MarkdownMeasure,
  sourceText?: string,
): MarkdownTextLayout | null => {
  if (typeof visualText !== "string") {
    throw new Error("layoutMarkdownText: visualText must be a string");
  }
  if (sourceText !== undefined && typeof sourceText !== "string") {
    throw new Error("layoutMarkdownText: sourceText must be a string");
  }
  validateMeasure(measure);
  parseFontString(font);
  if (!hasMarkdownSyntax(visualText) || isRTL(visualText)) {
    return null;
  }
  const continuation =
    sourceText !== undefined && sourceText !== visualText
      ? alignWrappedLines(sourceText, visualText)
      : null;
  const parsed = parseMarkdownText(
    visualText,
    continuation ? { continuation } : {},
  );
  if (isPlainMarkdown(parsed)) {
    return null;
  }

  const geometries = getLineGeometries(parsed, font, measure);
  const tables = layoutTables(parsed, font, measure);
  const lines = parsed.map((line, index): MarkdownVisualLine => {
    const tableLine = tables.get(index);
    if (tableLine) {
      return tableLine;
    }
    const { contentX, bullet, quoteBars } = geometries[index];
    const { segments, width } = buildSegments(
      line.runs,
      line.contentStart,
      Infinity,
      font,
      measure,
      contentX,
    );
    return {
      top: index,
      height: 1,
      width: segments.length || bullet ? contentX + width : 0,
      segments,
      bullet,
      quoteBars,
      table: null,
    };
  });
  return {
    lines,
    width: lines.reduce((max, line) => Math.max(max, line.width), 0),
  };
};

/** tokens of `content` with their offsets; whitespace tokens included */
const tokenize = (content: string) => {
  let tokens = parseTokens(content);
  if (tokens.join("") !== content) {
    // NFC normalization changed the text: offsets must follow the source
    tokens = content.split(/(\s+)/).filter(Boolean);
  }
  let offset = 0;
  return tokens.map((token) => {
    const start = offset;
    offset += token.length;
    return { token, start, end: offset };
  });
};

/**
 * Wraps `text` so each visual line's rendered Markdown fits `maxWidth`.
 * Mirrors `getWrappedTextLines` (offsets into `text`, trailing whitespace
 * trimmed at soft breaks); table rows and blank lines never wrap.
 */
export const wrapMarkdownText = (
  text: string,
  font: FontString,
  maxWidth: number,
  measure: MarkdownMeasure,
): WrappedTextLine[] => {
  if (typeof text !== "string") {
    throw new Error("wrapMarkdownText: text must be a string");
  }
  if (typeof maxWidth !== "number" || Number.isNaN(maxWidth)) {
    throw new Error("wrapMarkdownText: maxWidth must be a number");
  }
  validateMeasure(measure);
  parseFontString(font);

  const sourceLines = text.split("\n");
  const result: WrappedTextLine[] = [];
  const parsed = parseMarkdownText(text);
  const geometries = getLineGeometries(parsed, font, measure);
  let lineOffset = 0;

  const push = (line: string, start: number, end: number, trim: boolean) => {
    let trimmedEnd = end;
    while (trim && trimmedEnd > start && /\s/.test(line[trimmedEnd - 1])) {
      trimmedEnd--;
    }
    result.push({
      text: line.slice(start, trimmedEnd),
      start: lineOffset + start,
      end: lineOffset + trimmedEnd,
    });
  };

  sourceLines.forEach((line, index) => {
    const md = parsed[index];
    const { contentX } = geometries[index];
    const widthOf = (from: number, to: number) =>
      contentX + buildSegments(md.runs, from, to, font, measure, 0).width;

    if (
      !Number.isFinite(maxWidth) ||
      maxWidth < 0 ||
      md.kind !== "text" ||
      line.length <= md.contentStart ||
      widthOf(md.contentStart, line.length) <= maxWidth
    ) {
      push(line, 0, line.length, false);
      lineOffset += line.length + 1;
      return;
    }

    const contentStart = md.contentStart;
    let lineStart = 0;
    let lineEnd = contentStart;
    /** visible width already on the current visual line */
    let lineWidth = 0;
    for (const { token, start, end } of tokenize(line.slice(contentStart))) {
      const tokenStart = contentStart + start;
      const tokenEnd = contentStart + end;
      if (/^\s+$/.test(token)) {
        lineEnd = tokenEnd;
        continue;
      }
      const segmentStart = Math.max(lineStart, contentStart);
      const width = widthOf(segmentStart, tokenEnd);
      if (width <= maxWidth) {
        lineEnd = tokenEnd;
        lineWidth = width - contentX;
        continue;
      }
      if (lineWidth > 0) {
        push(line, lineStart, lineEnd, true);
        lineStart = tokenStart;
        lineEnd = tokenStart;
        lineWidth = 0;
        if (widthOf(tokenStart, tokenEnd) <= maxWidth) {
          lineEnd = tokenEnd;
          lineWidth = widthOf(tokenStart, tokenEnd) - contentX;
          continue;
        }
      }
      // the token alone is too wide: break it between characters
      let charStart = tokenStart;
      for (const char of Array.from(token)) {
        const charEnd = charStart + char.length;
        const from = Math.max(lineStart, contentStart);
        const charWidth = widthOf(from, charEnd);
        if (charWidth > maxWidth && lineWidth > 0) {
          push(line, lineStart, lineEnd, true);
          lineStart = charStart;
          lineWidth = widthOf(charStart, charEnd) - contentX;
        } else {
          lineWidth = charWidth - contentX;
        }
        lineEnd = charEnd;
        charStart = charEnd;
      }
    }
    push(line, lineStart, line.length, false);
    lineOffset += line.length + 1;
  });

  return result;
};
