/**
 * KuszCanvas: writes Markdown paint ops (see `getMarkdownPaintOps`) as SVG,
 * so exported text matches the canvas rendering.
 */
import { SVG_NS } from "@excalidraw/common";
import { MARKDOWN_CODE_FONT_FAMILY } from "@excalidraw/element";

import type { MarkdownPaintOp } from "@excalidraw/element";

/**
 * Appends one node per op to `parent`.
 *
 * @param fontFamily the element's CSS font-family list, for non-code runs
 * @param fontSize the element's font size in px
 */
export const appendMarkdownPaintOpsToSvg = (
  parent: SVGElement,
  ops: readonly MarkdownPaintOp[],
  fontFamily: string,
  fontSize: number,
): void => {
  if (!parent || typeof parent.appendChild !== "function") {
    throw new Error("appendMarkdownPaintOpsToSvg: parent must be an element");
  }
  if (!Array.isArray(ops)) {
    throw new Error("appendMarkdownPaintOpsToSvg: ops must be an array");
  }
  if (typeof fontFamily !== "string" || fontFamily.trim() === "") {
    throw new Error("appendMarkdownPaintOpsToSvg: fontFamily is required");
  }
  if (typeof fontSize !== "number" || !(fontSize > 0)) {
    throw new Error("appendMarkdownPaintOpsToSvg: fontSize must be positive");
  }
  const doc = parent.ownerDocument;
  for (const op of ops) {
    if (op.kind === "rect") {
      const rect = doc.createElementNS(SVG_NS, "rect");
      rect.setAttribute("x", `${op.x}`);
      rect.setAttribute("y", `${op.y}`);
      rect.setAttribute("width", `${op.width}`);
      rect.setAttribute("height", `${op.height}`);
      rect.setAttribute("fill", op.color);
      if (op.alpha !== 1) {
        // `opacity` multiplies the group's inherited fill-opacity
        rect.setAttribute("opacity", `${op.alpha}`);
      }
      if (op.radius > 0) {
        rect.setAttribute("rx", `${op.radius}`);
      }
      parent.appendChild(rect);
    } else if (op.kind === "circle") {
      const circle = doc.createElementNS(SVG_NS, "circle");
      circle.setAttribute("cx", `${op.cx}`);
      circle.setAttribute("cy", `${op.cy}`);
      circle.setAttribute("r", `${op.r}`);
      circle.setAttribute("fill", op.color);
      parent.appendChild(circle);
    } else {
      const text = doc.createElementNS(SVG_NS, "text");
      text.textContent = op.text;
      text.setAttribute("x", `${op.x}`);
      text.setAttribute("y", `${op.y}`);
      text.setAttribute(
        "font-family",
        op.style.code ? MARKDOWN_CODE_FONT_FAMILY : fontFamily,
      );
      text.setAttribute("font-size", `${fontSize}px`);
      if (op.style.bold) {
        text.setAttribute("font-weight", "bold");
      }
      if (op.style.italic) {
        text.setAttribute("font-style", "italic");
      }
      text.setAttribute("fill", op.color);
      text.setAttribute("text-anchor", "start");
      text.setAttribute("style", "white-space: pre;");
      text.setAttribute("direction", "ltr");
      text.setAttribute("dominant-baseline", "alphabetic");
      parent.appendChild(text);
    }
  }
};
