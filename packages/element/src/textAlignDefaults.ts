/**
 * KuszCanvas: where new text starts.
 *
 * - a sticky note's label: top-left, as written on paper;
 * - a shape's or arrow's label: centre-centre;
 * - loose text: the remembered `currentItemTextAlign` (left by default),
 *   which only picks that reach loose text update — justifying a label
 *   doesn't carry over to the next loose text.
 */
import { TEXT_ALIGN, VERTICAL_ALIGN } from "@excalidraw/common";

import { isStickyNoteElement } from "./typeChecks";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
  TextAlign,
  VerticalAlign,
} from "./types";

export const getDefaultBoundTextAlign = (
  container: ExcalidrawElement,
): Readonly<{ textAlign: TextAlign; verticalAlign: VerticalAlign }> => {
  if (!container || typeof container !== "object") {
    throw new Error("getDefaultBoundTextAlign(): container is required");
  }
  return isStickyNoteElement(container)
    ? { textAlign: TEXT_ALIGN.LEFT, verticalAlign: VERTICAL_ALIGN.TOP }
    : { textAlign: TEXT_ALIGN.CENTER, verticalAlign: VERTICAL_ALIGN.MIDDLE };
};

/**
 * Whether a text-alignment pick becomes the default for new loose text:
 * with no text targeted (it sets the tool default) or when it reaches at
 * least one loose text — never for labels alone.
 *
 * @param targets the text elements the pick is applied to
 */
export const shouldRememberTextAlign = (
  targets: readonly ExcalidrawTextElement[],
): boolean => {
  if (!Array.isArray(targets)) {
    throw new Error("shouldRememberTextAlign(): targets must be an array");
  }
  return (
    targets.length === 0 || targets.some((element) => !element.containerId)
  );
};
