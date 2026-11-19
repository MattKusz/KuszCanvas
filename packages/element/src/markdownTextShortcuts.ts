/**
 * KuszCanvas: Ctrl/Cmd + B, I and U in the text editor toggle Markdown
 * markers (`**`, `*`, `<u>…</u>`) around the selection.
 *
 * Pure: takes the editor's value and selection, returns the edit. The editor
 * applies it (see `wysiwyg/textWysiwyg.markdown.ts`).
 */
import { parseMarkdownText } from "./markdownText";

export type MarkdownShortcutStyle = "bold" | "italic" | "underline";

export type MarkdownShortcutKey = Readonly<{
  /** `KeyboardEvent.key` */
  key: string;
  /** `KeyboardEvent.code`, for layouts whose letters aren't Latin */
  code: string;
  ctrlOrCmd: boolean;
  shiftKey: boolean;
  altKey: boolean;
}>;

export type MarkdownStyleEdit = Readonly<{
  value: string;
  selectionStart: number;
  selectionEnd: number;
  /** the same edit as one replacement of `[replaceStart, replaceEnd)` */
  replaceStart: number;
  replaceEnd: number;
  replacement: string;
}>;

const SHORTCUTS: Readonly<Record<string, MarkdownShortcutStyle>> =
  Object.freeze({ b: "bold", i: "italic", u: "underline" });

const SHORTCUT_CODES: Readonly<Record<string, MarkdownShortcutStyle>> =
  Object.freeze({ KeyB: "bold", KeyI: "italic", KeyU: "underline" });

/** The style a key press toggles, or `null` for any other key. */
export const getMarkdownShortcutStyle = (
  event: MarkdownShortcutKey,
): MarkdownShortcutStyle | null => {
  if (!event || typeof event !== "object" || typeof event.key !== "string") {
    throw new Error("getMarkdownShortcutStyle: event must be a key event");
  }
  if (!event.ctrlOrCmd || event.shiftKey || event.altKey) {
    return null;
  }
  return (
    SHORTCUTS[event.key.toLowerCase()] ?? SHORTCUT_CODES[event.code] ?? null
  );
};

const STYLES: readonly MarkdownShortcutStyle[] = [
  "bold",
  "italic",
  "underline",
];

const isWhitespace = (char: string | undefined) =>
  char !== undefined && /\s/.test(char);

const countRunBefore = (value: string, at: number, char: string) => {
  let count = 0;
  while (at - count - 1 >= 0 && value[at - count - 1] === char) {
    count++;
  }
  return count;
};

const countRunAfter = (value: string, at: number, char: string) => {
  let count = 0;
  while (at + count < value.length && value[at + count] === char) {
    count++;
  }
  return count;
};

/** Markers found around or just inside `[from, to)`. */
type Markers = Readonly<{
  /** characters to delete before the content */
  open: number;
  /** characters to delete after the content */
  close: number;
  /** whether the markers sit inside `[from, to)` */
  inner: boolean;
}>;

const UNDERLINE_OPEN = "<u>";
const UNDERLINE_CLOSE = "</u>";

const findUnderline = (
  value: string,
  from: number,
  to: number,
): Markers | null => {
  const lower = value.toLowerCase();
  if (
    lower.slice(from - UNDERLINE_OPEN.length, from) === UNDERLINE_OPEN &&
    lower.slice(to, to + UNDERLINE_CLOSE.length) === UNDERLINE_CLOSE
  ) {
    return {
      open: UNDERLINE_OPEN.length,
      close: UNDERLINE_CLOSE.length,
      inner: false,
    };
  }
  const selected = lower.slice(from, to);
  if (
    selected.length >= UNDERLINE_OPEN.length + UNDERLINE_CLOSE.length &&
    selected.startsWith(UNDERLINE_OPEN) &&
    selected.endsWith(UNDERLINE_CLOSE)
  ) {
    return {
      open: UNDERLINE_OPEN.length,
      close: UNDERLINE_CLOSE.length,
      inner: true,
    };
  }
  return null;
};

/** `*`/`_` delimiter runs: 1 is italic, 2 bold, 3 both. */
const findEmphasis = (
  value: string,
  from: number,
  to: number,
  style: "bold" | "italic",
): Markers | null => {
  const has = (count: number) =>
    style === "bold" ? count >= 2 : count === 1 || count >= 3;
  const remove = style === "bold" ? 2 : 1;
  for (const char of ["*", "_"]) {
    const outer = Math.min(
      countRunBefore(value, from, char),
      countRunAfter(value, to, char),
    );
    if (outer > 0) {
      return has(outer) ? { open: remove, close: remove, inner: false } : null;
    }
    const innerOpen = countRunAfter(value, from, char);
    if (innerOpen > 0 && innerOpen < to - from) {
      const inner = Math.min(innerOpen, countRunBefore(value, to, char));
      if (inner > 0) {
        return has(inner) ? { open: remove, close: remove, inner: true } : null;
      }
    }
  }
  return null;
};

const findMarkers = (
  value: string,
  from: number,
  to: number,
  style: MarkdownShortcutStyle,
) =>
  style === "underline"
    ? findUnderline(value, from, to)
    : findEmphasis(value, from, to, style);

const getOpenClose = (style: MarkdownShortcutStyle) =>
  style === "underline"
    ? { open: UNDERLINE_OPEN, close: UNDERLINE_CLOSE }
    : style === "bold"
    ? { open: "**", close: "**" }
    : { open: "*", close: "*" };

/** A replacement of `[start, end)`, with its content's range within it. */
type Change = {
  start: number;
  end: number;
  text: string;
  contentStart: number;
  contentEnd: number;
};

const validate = (
  value: string,
  selectionStart: number,
  selectionEnd: number,
  style: MarkdownShortcutStyle,
) => {
  if (typeof value !== "string") {
    throw new Error("toggleMarkdownStyle: value must be a string");
  }
  if (
    !Number.isInteger(selectionStart) ||
    !Number.isInteger(selectionEnd) ||
    selectionStart < 0 ||
    selectionStart > selectionEnd ||
    selectionEnd > value.length
  ) {
    throw new Error(
      "toggleMarkdownStyle: selection must be integers within the value",
    );
  }
  if (!STYLES.includes(style)) {
    throw new Error(`toggleMarkdownStyle: unknown style "${style}"`);
  }
};

const toEdit = (
  value: string,
  changes: readonly Change[],
  fallbackSelection: readonly [number, number],
): MarkdownStyleEdit => {
  if (!changes.length) {
    return {
      value,
      selectionStart: fallbackSelection[0],
      selectionEnd: fallbackSelection[1],
      replaceStart: fallbackSelection[0],
      replaceEnd: fallbackSelection[0],
      replacement: "",
    };
  }
  let result = "";
  let position = 0;
  let selectionStart = 0;
  let selectionEnd = 0;
  changes.forEach((change, index) => {
    result += value.slice(position, change.start);
    if (index === 0) {
      selectionStart = result.length + change.contentStart;
    }
    if (index === changes.length - 1) {
      selectionEnd = result.length + change.contentEnd;
    }
    result += change.text;
    position = change.end;
  });
  const replaceStart = changes[0].start;
  const replaceEnd = changes[changes.length - 1].end;
  const tail = value.length - replaceEnd;
  result += value.slice(position);
  return {
    value: result,
    selectionStart,
    selectionEnd,
    replaceStart,
    replaceEnd,
    replacement: result.slice(replaceStart, result.length - tail),
  };
};

/**
 * Toggles `style` on the selection of `value`.
 *
 * A caret gets an empty marker pair (or loses one it sits in). A selection
 * is styled line by line, past list and quote prefixes and surrounding
 * whitespace; the style comes off when every selected line already has it.
 * The result selects the styled text without its markers.
 */
export const toggleMarkdownStyle = (
  value: string,
  selectionStart: number,
  selectionEnd: number,
  style: MarkdownShortcutStyle,
): MarkdownStyleEdit => {
  validate(value, selectionStart, selectionEnd, style);
  const { open, close } = getOpenClose(style);

  if (selectionStart === selectionEnd) {
    const caret = selectionStart;
    const isEmptyPair =
      value.slice(caret - open.length, caret).toLowerCase() === open &&
      value.slice(caret, caret + close.length).toLowerCase() === close &&
      (style === "underline" || !!findMarkers(value, caret, caret, style));
    return toEdit(
      value,
      [
        isEmptyPair
          ? {
              start: caret - open.length,
              end: caret + close.length,
              text: "",
              contentStart: 0,
              contentEnd: 0,
            }
          : {
              start: caret,
              end: caret,
              text: open + close,
              contentStart: open.length,
              contentEnd: open.length,
            },
      ],
      [caret, caret],
    );
  }

  const parsed = parseMarkdownText(value);
  const segments: { from: number; to: number; markers: Markers | null }[] = [];
  let lineStart = 0;
  value.split("\n").forEach((line, index) => {
    const lineEnd = lineStart + line.length;
    const contentStart = lineStart + parsed[index].contentStart;
    let from = Math.max(selectionStart, contentStart);
    let to = Math.min(selectionEnd, lineEnd);
    while (from < to && isWhitespace(value[from])) {
      from++;
    }
    while (to > from && isWhitespace(value[to - 1])) {
      to--;
    }
    if (from < to) {
      segments.push({ from, to, markers: findMarkers(value, from, to, style) });
    }
    lineStart = lineEnd + 1;
  });

  const removeAll = segments.every((segment) => segment.markers);
  const changes = segments.map(({ from, to, markers }): Change => {
    const content = value.slice(from, to);
    if (markers && removeAll) {
      if (markers.inner) {
        const inner = content.slice(
          markers.open,
          content.length - markers.close,
        );
        return {
          start: from,
          end: to,
          text: inner,
          contentStart: 0,
          contentEnd: inner.length,
        };
      }
      return {
        start: from - markers.open,
        end: to + markers.close,
        text: content,
        contentStart: 0,
        contentEnd: content.length,
      };
    }
    if (markers) {
      // already styled: unchanged, selected without its markers
      const contentStart = markers.inner ? markers.open : 0;
      const contentEnd = markers.inner
        ? content.length - markers.close
        : content.length;
      return { start: from, end: to, text: content, contentStart, contentEnd };
    }
    return {
      start: from,
      end: to,
      text: open + content + close,
      contentStart: open.length,
      contentEnd: open.length + content.length,
    };
  });
  return toEdit(value, changes, [selectionStart, selectionEnd]);
};
