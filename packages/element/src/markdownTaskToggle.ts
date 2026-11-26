/**
 * KuszCanvas: clicking a rendered task checkbox toggles `[ ]` / `[x]` in the
 * text element's source.
 *
 * Pure: hit-tests the paint ops (element-local coordinates), maps the hit
 * visual line back to its source line and rewrites the source. The editor
 * owns the pointer handling and the scene update (`App.markdownTasks.ts`).
 */
import { parseMarkdownText } from "./markdownText";
import { alignWrappedLines } from "./markdownTextLayout";

import type { MarkdownPaintOp } from "./markdownTextRender";

const validateText = (text: unknown, name: string): string => {
  if (typeof text !== "string") {
    throw new Error(`${name} must be a string`);
  }
  return text;
};

/** Source line indices of the task items (`- [ ]`, `1. [x]`, …) in `text`. */
export const getMarkdownTaskLines = (text: string): number[] => {
  validateText(text, "getMarkdownTaskLines: text");
  return parseMarkdownText(text).flatMap((line, index) =>
    line.marker?.task ? [index] : [],
  );
};

/**
 * Ticks the open task on source line `line` of `text`, or clears a done one.
 * Throws if that line is not a task item.
 */
export const toggleMarkdownTask = (text: string, line: number): string => {
  validateText(text, "toggleMarkdownTask: text");
  const lines = text.split("\n");
  if (!Number.isInteger(line) || line < 0 || line >= lines.length) {
    throw new Error("toggleMarkdownTask: line must be a line index of text");
  }
  const parsed = parseMarkdownText(text)[line];
  if (!parsed?.marker?.task) {
    throw new Error(`toggleMarkdownTask: line ${line} is not a task item`);
  }
  // the checkbox is the last `[` before the content
  const prefix = lines[line].slice(0, parsed.contentStart);
  const open = prefix.lastIndexOf("[");
  if (open < 0 || prefix[open + 2] !== "]") {
    throw new Error(`toggleMarkdownTask: no checkbox on line ${line}`);
  }
  const mark = parsed.marker.task === "done" ? " " : "x";
  lines[line] =
    lines[line].slice(0, open + 1) + mark + lines[line].slice(open + 2);
  return lines.join("\n");
};

export type MarkdownTaskTexts = Readonly<{
  /** the displayed (unwrapped) text the checkbox was hit in */
  originalText: string;
  /** the host's raw source; empty when the host keeps none */
  rawText: string;
}>;

/**
 * Toggles the task on `line` of `originalText`, and the same task (by its
 * order among the tasks) in `rawText`, which a host may keep with different
 * lines above the task. Returns `null` when the raw source's tasks don't
 * match the displayed ones, so the toggle can't be placed safely.
 */
export const toggleMarkdownTaskInTexts = (
  texts: MarkdownTaskTexts,
  line: number,
): MarkdownTaskTexts | null => {
  if (!texts || typeof texts !== "object") {
    throw new Error("toggleMarkdownTaskInTexts: texts must be an object");
  }
  const originalText = validateText(
    texts.originalText,
    "toggleMarkdownTaskInTexts: originalText",
  );
  const rawText = validateText(
    texts.rawText,
    "toggleMarkdownTaskInTexts: rawText",
  );
  const nextOriginal = toggleMarkdownTask(originalText, line);
  if (!rawText || rawText === originalText) {
    return { originalText: nextOriginal, rawText: nextOriginal };
  }
  const shownTasks = getMarkdownTaskLines(originalText);
  const rawTasks = getMarkdownTaskLines(rawText);
  const order = shownTasks.indexOf(line);
  if (rawTasks.length !== shownTasks.length || order < 0) {
    return null;
  }
  const rawLine = rawTasks[order];
  const shownState = parseMarkdownText(originalText)[line].marker?.task;
  const rawState = parseMarkdownText(rawText)[rawLine].marker?.task;
  if (shownState !== rawState) {
    return null;
  }
  return {
    originalText: nextOriginal,
    rawText: toggleMarkdownTask(rawText, rawLine),
  };
};

/**
 * The source line of `visualText`'s line `visualLine`, where `visualText`
 * is a wrap of `sourceText`. Returns `null` if the texts don't align.
 */
export const getMarkdownSourceLine = (
  sourceText: string,
  visualText: string,
  visualLine: number,
): number | null => {
  validateText(sourceText, "getMarkdownSourceLine: sourceText");
  validateText(visualText, "getMarkdownSourceLine: visualText");
  const visualCount = visualText.split("\n").length;
  if (
    !Number.isInteger(visualLine) ||
    visualLine < 0 ||
    visualLine >= visualCount
  ) {
    throw new Error(
      "getMarkdownSourceLine: visualLine must be a line index of visualText",
    );
  }
  if (sourceText === visualText) {
    return visualLine;
  }
  const continuation = alignWrappedLines(sourceText, visualText);
  if (!continuation) {
    return null;
  }
  let sourceLine = -1;
  for (let index = 0; index <= visualLine; index++) {
    if (!continuation[index]) {
      sourceLine++;
    }
  }
  return sourceLine;
};

/**
 * The visual line of the checkbox under `point` (element-local), within
 * `slop` of its box, or `null`.
 */
export const findMarkdownCheckboxAt = (
  ops: readonly MarkdownPaintOp[],
  point: Readonly<{ x: number; y: number }>,
  slop: number,
): number | null => {
  if (!Array.isArray(ops)) {
    throw new Error("findMarkdownCheckboxAt: ops must be an array");
  }
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error("findMarkdownCheckboxAt: point must be finite");
  }
  if (!Number.isFinite(slop) || slop < 0) {
    throw new Error("findMarkdownCheckboxAt: slop must be >= 0");
  }
  for (const op of ops) {
    if (
      op.kind === "checkbox" &&
      point.x >= op.x - slop &&
      point.x <= op.x + op.size + slop &&
      point.y >= op.y - slop &&
      point.y <= op.y + op.size + slop
    ) {
      return op.line;
    }
  }
  return null;
};
