/**
 * KuszCanvas: the blackboard board texture on canvas.
 *
 * The board is drawn by a WebGL2 shader (`blackboardShaderCanvas.ts`,
 * built from `blackboardShader.ts`) anchored in scene space, so it never
 * repeats at any zoom. Where WebGL2 is missing (jsdom, node-canvas,
 * OffscreenCanvas) the flat `BLACKBOARD_BASE_COLOR` fill that
 * `bootstrapCanvas` paints first is the board.
 */
import type { RenderEnvironment } from "@excalidraw/element";

import { paintBoardShader } from "./blackboardShaderCanvas";

export type BlackboardView = Readonly<{
  scrollX: number;
  scrollY: number;
  zoom: number;
}>;

/**
 * Paints the board texture over `width` × `height` CSS px of `context`
 * (already scaled to CSS px). Leaves the context untouched where the shader
 * cannot run.
 */
export const paintBlackboardBackground = (
  context: CanvasRenderingContext2D,
  view: BlackboardView,
  width: number,
  height: number,
  // kept for callers; the shader needs a DOM document, not the environment
  _environment?: RenderEnvironment,
): void => {
  if (!context) {
    throw new Error("paintBlackboardBackground(): context is required");
  }
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error("paintBlackboardBackground(): size must be finite");
  }
  if (!view) {
    throw new Error("paintBlackboardBackground(): view is required");
  }
  if (width <= 0 || height <= 0) {
    return;
  }
  paintBoardShader(context, view, width, height);
};
