import { isMarkdownTextRenderingEnabled } from "@excalidraw/common";

/**
 * KuszCanvas: whether text sizing follows rendered Markdown.
 *
 * The text editor shows raw Markdown (markers visible), so while it measures
 * the text it edits, sizing must use the raw text: `withRawTextLayout` scopes
 * that synchronously. Rendering is unaffected -- it reads the host flag.
 */
let rawTextLayoutDepth = 0;

/** Runs `fn` with text measured and wrapped as raw text. */
export const withRawTextLayout = <T>(fn: () => T): T => {
  if (typeof fn !== "function") {
    throw new Error("withRawTextLayout: fn must be a function");
  }
  rawTextLayoutDepth++;
  try {
    return fn();
  } finally {
    rawTextLayoutDepth--;
  }
};

/** Whether `measureText`/`wrapText` lay text out as rendered Markdown. */
export const isMarkdownTextLayoutActive = (): boolean =>
  rawTextLayoutDepth === 0 && isMarkdownTextRenderingEnabled();
