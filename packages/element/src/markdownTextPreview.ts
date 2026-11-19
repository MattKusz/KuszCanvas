/**
 * KuszCanvas: live Markdown preview for the text editor.
 *
 * While a text is edited, the lines holding the selection show raw Markdown
 * (markers visible, so the caret lines up with the editor's text) and every
 * other line renders as Markdown. The layout keeps the editor's own line
 * breaks, so lines below the caret stay where the editor puts them.
 *
 * Pure given a `measure` function.
 */
import { PLAIN_MARKDOWN_STYLE } from "./markdownText";
import { alignWrappedLines, layoutMarkdownText } from "./markdownTextLayout";

import type {
  MarkdownMeasure,
  MarkdownTextLayout,
  MarkdownVisualLine,
} from "./markdownTextLayout";
import type { FontString } from "./types";

/** First and last source line (0-based, inclusive). */
export type SourceLineRange = Readonly<{ first: number; last: number }>;

/** The source lines that `[selectionStart, selectionEnd]` touches. */
export const getSourceLineRange = (
  sourceText: string,
  selectionStart: number,
  selectionEnd: number,
): SourceLineRange => {
  if (typeof sourceText !== "string") {
    throw new Error("getSourceLineRange: sourceText must be a string");
  }
  if (
    !Number.isInteger(selectionStart) ||
    !Number.isInteger(selectionEnd) ||
    selectionStart < 0 ||
    selectionStart > selectionEnd ||
    selectionEnd > sourceText.length
  ) {
    throw new Error(
      "getSourceLineRange: selection must be integers within the text",
    );
  }
  const lineOf = (offset: number) =>
    sourceText.slice(0, offset).split("\n").length - 1;
  return { first: lineOf(selectionStart), last: lineOf(selectionEnd) };
};

export type MarkdownLivePreviewOptions = Readonly<{
  /** the editor's lines: `sourceText` wrapped as raw text */
  visualText: string;
  /** the editor's value */
  sourceText: string;
  font: FontString;
  measure: MarkdownMeasure;
  /** source lines drawn raw */
  revealed: SourceLineRange;
}>;

const rawLine = (
  text: string,
  top: number,
  font: FontString,
  measure: MarkdownMeasure,
): MarkdownVisualLine => {
  const width = text ? measure(text, font) : 0;
  return {
    top,
    height: 1,
    width,
    segments: text
      ? [
          {
            text,
            x: 0,
            width,
            textX: 0,
            textWidth: width,
            style: PLAIN_MARKDOWN_STYLE,
            font,
          },
        ]
      : [],
    bullet: null,
    quoteBars: [],
    table: null,
  };
};

/**
 * Lays the edited text out for the live preview: one line per visual line,
 * raw on the revealed source lines (and on any table they touch, whose rows
 * otherwise share space), Markdown elsewhere.
 *
 * Returns `null` when the preview would look exactly like the editor's raw
 * text, or when `visualText` is not a wrap of `sourceText` (a stale wrap):
 * the editor then shows its own text.
 */
export const layoutMarkdownLivePreview = (
  options: MarkdownLivePreviewOptions,
): MarkdownTextLayout | null => {
  if (!options || typeof options !== "object") {
    throw new Error("layoutMarkdownLivePreview: options must be an object");
  }
  const { visualText, sourceText, font, measure, revealed } = options;
  if (typeof visualText !== "string") {
    throw new Error("layoutMarkdownLivePreview: visualText must be a string");
  }
  if (typeof sourceText !== "string") {
    throw new Error("layoutMarkdownLivePreview: sourceText must be a string");
  }
  if (typeof measure !== "function") {
    throw new Error("layoutMarkdownLivePreview: measure must be a function");
  }
  if (
    !revealed ||
    !Number.isInteger(revealed.first) ||
    !Number.isInteger(revealed.last) ||
    revealed.first < 0 ||
    revealed.first > revealed.last
  ) {
    throw new Error(
      "layoutMarkdownLivePreview: revealed must be an ordered line range",
    );
  }

  const visualLines = visualText.split("\n");
  const continuation =
    visualText === sourceText
      ? visualLines.map(() => false)
      : alignWrappedLines(sourceText, visualText);
  if (!continuation) {
    return null;
  }
  const layout = layoutMarkdownText(visualText, font, measure, sourceText);
  if (!layout) {
    return null;
  }

  // the source line of each visual line
  let sourceLine = -1;
  const isRevealed = continuation.map((continues) => {
    if (!continues) {
      sourceLine++;
    }
    return sourceLine >= revealed.first && sourceLine <= revealed.last;
  });
  // a table's rows share its height: reveal all of it or none
  let index = 0;
  while (index < layout.lines.length) {
    if (!layout.lines[index].table) {
      index++;
      continue;
    }
    let end = index;
    while (end < layout.lines.length && layout.lines[end].table) {
      end++;
    }
    if (isRevealed.slice(index, end).some(Boolean)) {
      isRevealed.fill(true, index, end);
    }
    index = end;
  }
  if (isRevealed.every(Boolean)) {
    return null;
  }

  const lines = layout.lines.map((line, lineIndex) =>
    isRevealed[lineIndex]
      ? rawLine(visualLines[lineIndex], lineIndex, font, measure)
      : line,
  );
  return {
    lines,
    width: lines.reduce((max, line) => Math.max(max, line.width), 0),
  };
};
