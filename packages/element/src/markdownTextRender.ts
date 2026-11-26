/**
 * KuszCanvas: paints a laid-out Markdown text element.
 *
 * Geometry comes from `layoutMarkdownText`, the same layout that sizes and
 * wraps the element, so what is drawn matches what was measured.
 * `getMarkdownPaintOps` turns a layout into positioned rectangles, circles
 * and text runs (pure); the canvas renderer and the SVG exporter each replay
 * those ops, so both outputs share one geometry.
 */
import { getFontString, getVerticalOffset } from "@excalidraw/common";

import { MARKDOWN_TEXT_METRICS } from "./markdownTextLayout";
import { getLineHeightInPx } from "./textMeasurements";

import type { MarkdownInlineStyle } from "./markdownText";
import type {
  MarkdownSegment,
  MarkdownTextLayout,
  MarkdownVisualLine,
} from "./markdownTextLayout";
import type { ExcalidrawTextElement, FontString } from "./types";

/** Highlighter yellow; translucent so it reads on light and dark scenes. */
export const MARKDOWN_HIGHLIGHT_COLOR = "rgba(255, 208, 0, 0.4)";

/** Opacities applied to the text colour for secondary marks. */
export const MARKDOWN_MARK_ALPHA = Object.freeze({
  codeBackground: 0.1,
  quoteBar: 0.35,
  tableGrid: 0.4,
  tableHeader: 0.06,
});

/** Checkbox corner radius and tick, as fractions of the box size. */
export const MARKDOWN_CHECKBOX = Object.freeze({
  radius: 0.2,
  tick: Object.freeze([
    [0.22, 0.52],
    [0.42, 0.72],
    [0.78, 0.3],
  ] as const),
});

/** Decoration offsets from the baseline, in em. */
export const MARKDOWN_DECORATION = Object.freeze({
  underlineOffset: 0.12,
  strikeOffset: -0.3,
  thickness: 0.06,
  bulletCentre: -0.32,
});

export type MarkdownDrawOptions = Readonly<{
  layout: MarkdownTextLayout;
  /** the element's font, for ordered-list labels */
  font: FontString;
  /** element width, which alignment offsets each line within */
  width: number;
  /** "left", "center" or "right" (checked at runtime: elements type it as string) */
  textAlign: string;
  fontSize: number;
  lineHeightPx: number;
  /** baseline offset from the top of a line */
  verticalOffset: number;
  /** text colour, dark-mode filter already applied */
  color: string;
}>;

/** KuszCanvas: what a Markdown rect paints, so blackboard mode can layer it. */
export type MarkdownRectRole =
  | "highlight"
  | "code"
  | "tableHeader"
  | "tableGrid"
  | "quote"
  | "decoration";

export type MarkdownPaintOp = Readonly<
  | {
      kind: "rect";
      role: MarkdownRectRole;
      x: number;
      y: number;
      width: number;
      height: number;
      color: string;
      /** multiplies the element opacity */
      alpha: number;
      radius: number;
    }
  | {
      kind: "circle";
      cx: number;
      cy: number;
      r: number;
      color: string;
    }
  | {
      /** a task's box, stroked; a done task's also gets a tick */
      kind: "checkbox";
      /** the visual line it sits on (for hit-testing clicks) */
      line: number;
      /** top-left corner */
      x: number;
      y: number;
      size: number;
      checked: boolean;
      lineWidth: number;
      radius: number;
      color: string;
    }
  | {
      kind: "text";
      text: string;
      /** left edge of the text, at `y` = baseline */
      x: number;
      y: number;
      font: FontString;
      style: MarkdownInlineStyle;
      color: string;
    }
>;

const assertFinite = (name: string, value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Markdown paint: ${name} must be a finite number`);
  }
};

const assertString = (name: string, value: unknown) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Markdown paint: ${name} must be a non-empty string`);
  }
};

const validateOptions = (options: MarkdownDrawOptions) => {
  if (!options || typeof options !== "object") {
    throw new Error("Markdown paint: options must be an object");
  }
  if (!options.layout || !Array.isArray(options.layout.lines)) {
    throw new Error("Markdown paint: layout must be a Markdown layout");
  }
  assertFinite("width", options.width);
  assertFinite("fontSize", options.fontSize);
  assertFinite("lineHeightPx", options.lineHeightPx);
  assertFinite("verticalOffset", options.verticalOffset);
  if (!["left", "center", "right"].includes(options.textAlign)) {
    throw new Error("Markdown paint: textAlign must be left, center or right");
  }
  assertString("font", options.font);
  assertString("color", options.color);
};

const getLineX = (line: MarkdownVisualLine, options: MarkdownDrawOptions) =>
  options.textAlign === "center"
    ? (options.width - line.width) / 2
    : options.textAlign === "right"
    ? options.width - line.width
    : 0;

const pushTableGrid = (
  ops: MarkdownPaintOp[],
  line: MarkdownVisualLine,
  lineX: number,
  rowTop: number,
  rowHeight: number,
  options: MarkdownDrawOptions,
) => {
  const table = line.table!;
  const thickness = Math.max(
    1,
    options.fontSize * MARKDOWN_DECORATION.thickness,
  );
  const rect = (
    role: MarkdownRectRole,
    x: number,
    y: number,
    width: number,
    height: number,
    alpha: number,
  ) =>
    ops.push({
      kind: "rect",
      role,
      x,
      y,
      width,
      height,
      color: options.color,
      alpha,
      radius: 0,
    });
  const grid = MARKDOWN_MARK_ALPHA.tableGrid;
  if (rowHeight > 0) {
    if (table.isHeader) {
      rect(
        "tableHeader",
        lineX,
        rowTop,
        table.width,
        rowHeight,
        MARKDOWN_MARK_ALPHA.tableHeader,
      );
    }
    rect("tableGrid", lineX, rowTop, table.width, thickness, grid);
    for (const columnX of table.columnXs) {
      rect("tableGrid", lineX + columnX, rowTop, thickness, rowHeight, grid);
    }
    rect(
      "tableGrid",
      lineX + table.width - thickness,
      rowTop,
      thickness,
      rowHeight,
      grid,
    );
  }
  if (table.isLastRow) {
    rect(
      "tableGrid",
      lineX,
      rowTop + rowHeight - thickness,
      table.width,
      thickness,
      grid,
    );
  }
};

const pushSegment = (
  ops: MarkdownPaintOp[],
  segment: MarkdownSegment,
  lineX: number,
  textTop: number,
  baseline: number,
  options: MarkdownDrawOptions,
) => {
  const { style } = segment;
  const { fontSize, lineHeightPx } = options;
  const x = lineX + segment.x;
  const inset = lineHeightPx * 0.08;
  const boxTop = textTop + inset;
  const boxHeight = lineHeightPx - 2 * inset;

  if (style.highlight) {
    ops.push({
      kind: "rect",
      role: "highlight",
      x,
      y: boxTop,
      width: segment.width,
      height: boxHeight,
      color: MARKDOWN_HIGHLIGHT_COLOR,
      alpha: 1,
      radius: 0,
    });
  }
  if (style.code) {
    ops.push({
      kind: "rect",
      role: "code",
      x,
      y: boxTop,
      width: segment.width,
      height: boxHeight,
      color: options.color,
      alpha: MARKDOWN_MARK_ALPHA.codeBackground,
      radius: fontSize * 0.2,
    });
  }

  const { color } = options;
  const textX = lineX + segment.textX;
  ops.push({
    kind: "text",
    text: segment.text,
    x: textX,
    y: baseline,
    font: segment.font,
    style,
    color,
  });

  const thickness = Math.max(1, fontSize * MARKDOWN_DECORATION.thickness);
  const decoration = (y: number) =>
    ops.push({
      kind: "rect",
      role: "decoration",
      x: textX,
      y,
      width: segment.textWidth,
      height: thickness,
      color,
      alpha: 1,
      radius: 0,
    });
  if (style.underline) {
    decoration(baseline + fontSize * MARKDOWN_DECORATION.underlineOffset);
  }
  if (style.strike) {
    decoration(
      baseline + fontSize * MARKDOWN_DECORATION.strikeOffset - thickness / 2,
    );
  }
};

const PLAIN_STYLE: MarkdownInlineStyle = Object.freeze({
  bold: false,
  italic: false,
  strike: false,
  underline: false,
  highlight: false,
  code: false,
});

/** Paint ops for `options.layout`, with the element's top-left at the origin. */
export const getMarkdownPaintOps = (
  options: MarkdownDrawOptions,
): MarkdownPaintOp[] => {
  validateOptions(options);
  const { fontSize, lineHeightPx, verticalOffset, color } = options;
  const ops: MarkdownPaintOp[] = [];

  for (const line of options.layout.lines) {
    const lineX = getLineX(line, options);
    const rowTop = line.top * lineHeightPx;
    const rowHeight = line.height * lineHeightPx;
    // taller (table) rows centre their text
    const textTop = rowTop + (rowHeight - lineHeightPx) / 2;
    const baseline = textTop + verticalOffset;

    if (line.table) {
      pushTableGrid(ops, line, lineX, rowTop, rowHeight, options);
    }
    for (const barX of line.quoteBars) {
      ops.push({
        kind: "rect",
        role: "quote",
        x: lineX + barX,
        y: rowTop,
        width: fontSize * MARKDOWN_TEXT_METRICS.quoteBarWidth,
        height: rowHeight,
        color,
        alpha: MARKDOWN_MARK_ALPHA.quoteBar,
        radius: 0,
      });
    }
    if (line.bullet?.kind === "dot") {
      ops.push({
        kind: "circle",
        cx: lineX + line.bullet.cx,
        cy: baseline + fontSize * MARKDOWN_DECORATION.bulletCentre,
        r: fontSize * MARKDOWN_TEXT_METRICS.bulletRadius,
        color,
      });
    } else if (line.bullet?.kind === "label") {
      ops.push({
        kind: "text",
        text: line.bullet.text,
        x: lineX + line.bullet.x,
        y: baseline,
        font: options.font,
        style: PLAIN_STYLE,
        color,
      });
    }
    if (line.checkbox) {
      const { size } = line.checkbox;
      ops.push({
        kind: "checkbox",
        line: line.top,
        x: lineX + line.checkbox.x,
        // centred where a bullet dot is
        y: baseline + fontSize * MARKDOWN_DECORATION.bulletCentre - size / 2,
        size,
        checked: line.checkbox.checked,
        lineWidth: Math.max(1, fontSize * MARKDOWN_DECORATION.thickness),
        radius: size * MARKDOWN_CHECKBOX.radius,
        color,
      });
    }
    for (const segment of line.segments) {
      pushSegment(ops, segment, lineX, textTop, baseline, options);
    }
  }
  return ops;
};

/**
 * Draws `options.layout` on a canvas, with the element's top-left at the
 * origin. `include` limits the ops drawn (blackboard mode paints one chalk
 * layer at a time). Returns whether any op was drawn.
 */
export const drawMarkdownText = (
  context: CanvasRenderingContext2D,
  options: MarkdownDrawOptions,
  include?: (op: MarkdownPaintOp) => boolean,
): boolean => {
  if (!context) {
    throw new Error("drawMarkdownText: context is required");
  }
  if (include !== undefined && typeof include !== "function") {
    throw new Error("drawMarkdownText: include must be a function");
  }
  const ops = include
    ? getMarkdownPaintOps(options).filter(include)
    : getMarkdownPaintOps(options);
  context.save();
  context.textAlign = "left";
  const baseAlpha = context.globalAlpha;
  for (const op of ops) {
    context.fillStyle = op.color;
    if (op.kind === "rect") {
      context.globalAlpha = baseAlpha * op.alpha;
      if (op.radius > 0 && typeof context.roundRect === "function") {
        context.beginPath();
        context.roundRect(op.x, op.y, op.width, op.height, op.radius);
        context.fill();
      } else {
        context.fillRect(op.x, op.y, op.width, op.height);
      }
      context.globalAlpha = baseAlpha;
    } else if (op.kind === "circle") {
      context.beginPath();
      context.arc(op.cx, op.cy, op.r, 0, Math.PI * 2);
      context.fill();
    } else if (op.kind === "checkbox") {
      context.strokeStyle = op.color;
      context.lineWidth = op.lineWidth;
      context.lineJoin = "round";
      context.lineCap = "round";
      context.beginPath();
      if (typeof context.roundRect === "function") {
        context.roundRect(op.x, op.y, op.size, op.size, op.radius);
      } else {
        context.rect(op.x, op.y, op.size, op.size);
      }
      context.stroke();
      if (op.checked) {
        context.beginPath();
        MARKDOWN_CHECKBOX.tick.forEach(([u, v], index) => {
          const x = op.x + u * op.size;
          const y = op.y + v * op.size;
          if (index === 0) {
            context.moveTo(x, y);
          } else {
            context.lineTo(x, y);
          }
        });
        context.stroke();
      }
    } else {
      context.font = op.font;
      context.fillText(op.text, op.x, op.y);
    }
  }
  context.restore();
  return ops.length > 0;
};

/**
 * Draws a text element's lines as plain text, with the element's top-left at
 * the origin and each line aligned within `width` (the element's width on
 * the scene, the editor's box width in the live preview).
 */
export const drawPlainTextLines = (
  context: CanvasRenderingContext2D,
  element: Pick<
    ExcalidrawTextElement,
    "text" | "fontSize" | "lineHeight" | "fontFamily" | "textAlign"
  >,
  color: string,
  width: number,
): void => {
  if (!context) {
    throw new Error("drawPlainTextLines: context is required");
  }
  if (!element || typeof element.text !== "string") {
    throw new Error("drawPlainTextLines: element with text is required");
  }
  if (typeof color !== "string" || !color) {
    throw new Error("drawPlainTextLines: color is required");
  }
  if (!Number.isFinite(width)) {
    throw new Error("drawPlainTextLines: width must be finite");
  }
  context.font = getFontString(element);
  context.fillStyle = color;
  context.textAlign = element.textAlign as CanvasTextAlign;
  // canvas does not support multiline text
  const lines = element.text.replace(/\r\n?/g, "\n").split("\n");
  const horizontalOffset =
    element.textAlign === "center"
      ? width / 2
      : element.textAlign === "right"
      ? width
      : 0;
  const lineHeightPx = getLineHeightInPx(element.fontSize, element.lineHeight);
  const verticalOffset = getVerticalOffset(
    element.fontFamily,
    element.fontSize,
    lineHeightPx,
  );
  for (let index = 0; index < lines.length; index++) {
    context.fillText(
      lines[index],
      horizontalOffset,
      index * lineHeightPx + verticalOffset,
    );
  }
};
