/**
 * KuszCanvas: paints a laid-out Markdown text element.
 *
 * Geometry comes from `layoutMarkdownText`, the same layout that sizes and
 * wraps the element, so what is drawn matches what was measured.
 * `getMarkdownPaintOps` turns a layout into positioned rectangles, circles
 * and text runs (pure); the canvas renderer and the SVG exporter each replay
 * those ops, so both outputs share one geometry.
 */
import { MARKDOWN_TEXT_METRICS } from "./markdownTextLayout";

import type { MarkdownInlineStyle } from "./markdownText";
import type {
  MarkdownSegment,
  MarkdownTextLayout,
  MarkdownVisualLine,
} from "./markdownTextLayout";
import type { FontString } from "./types";

/** Highlighter yellow; translucent so it reads on light and dark scenes. */
export const MARKDOWN_HIGHLIGHT_COLOR = "rgba(255, 208, 0, 0.4)";

/** Opacities applied to the text or accent colour for secondary marks. */
export const MARKDOWN_MARK_ALPHA = Object.freeze({
  codeBackground: 0.1,
  tagBackground: 0.15,
  quoteBar: 0.35,
  tableGrid: 0.4,
  tableHeader: 0.06,
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
  /** tag colour (the host's accent) */
  accentColor: string;
}>;

export type MarkdownPaintOp = Readonly<
  | {
      kind: "rect";
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
  assertString("accentColor", options.accentColor);
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
    x: number,
    y: number,
    width: number,
    height: number,
    alpha: number,
  ) =>
    ops.push({
      kind: "rect",
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
        lineX,
        rowTop,
        table.width,
        rowHeight,
        MARKDOWN_MARK_ALPHA.tableHeader,
      );
    }
    rect(lineX, rowTop, table.width, thickness, grid);
    for (const columnX of table.columnXs) {
      rect(lineX + columnX, rowTop, thickness, rowHeight, grid);
    }
    rect(lineX + table.width - thickness, rowTop, thickness, rowHeight, grid);
  }
  if (table.isLastRow) {
    rect(lineX, rowTop + rowHeight - thickness, table.width, thickness, grid);
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
      x,
      y: boxTop,
      width: segment.width,
      height: boxHeight,
      color: options.color,
      alpha: MARKDOWN_MARK_ALPHA.codeBackground,
      radius: fontSize * 0.2,
    });
  }
  if (style.tag) {
    ops.push({
      kind: "rect",
      x,
      y: boxTop,
      width: segment.width,
      height: boxHeight,
      color: options.accentColor,
      alpha: MARKDOWN_MARK_ALPHA.tagBackground,
      radius: boxHeight / 2,
    });
  }

  const color = style.tag ? options.accentColor : options.color;
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
  tag: false,
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
    for (const segment of line.segments) {
      pushSegment(ops, segment, lineX, textTop, baseline, options);
    }
  }
  return ops;
};

/** Draws `options.layout` on a canvas, with the element's top-left at the origin. */
export const drawMarkdownText = (
  context: CanvasRenderingContext2D,
  options: MarkdownDrawOptions,
): void => {
  if (!context) {
    throw new Error("drawMarkdownText: context is required");
  }
  const ops = getMarkdownPaintOps(options);
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
    } else {
      context.font = op.font;
      context.fillText(op.text, op.x, op.y);
    }
  }
  context.restore();
};
