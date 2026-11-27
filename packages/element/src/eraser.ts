// KuszCanvas: which elements the eraser may remove, and where it must touch them.

import type { GlobalPoint } from "@excalidraw/math";

import { distanceToElement } from "./distance";
import {
  isBoundToContainer,
  isFrameLikeElement,
  isIframeLikeElement,
  isImageElement,
  isLineElement,
  isStickyNoteElement,
  isTextElement,
} from "./typeChecks";

import type { ElementsMap, ExcalidrawElement } from "./types";

const isProtectedType = (element: ExcalidrawElement | undefined) =>
  isStickyNoteElement(element) ||
  isIframeLikeElement(element ?? null) ||
  isImageElement(element ?? null);

/**
 * Sticky notes, embeds (iframe / embeddable) and images are never erased:
 * not by the trail, a click, their group or their frame being erased. A
 * sticky note's label shares its note's protection.
 */
export const isEraserProtected = (
  element: ExcalidrawElement,
  elementsMap: ElementsMap,
): boolean => {
  if (isProtectedType(element)) {
    return true;
  }
  return (
    isTextElement(element) &&
    !!element.containerId &&
    isProtectedType(elementsMap.get(element.containerId))
  );
};

/**
 * Closed shapes and frames are erased only where the eraser crosses their
 * outline, never through their fill.
 */
export const isEraserOutlineOnly = (element: ExcalidrawElement): boolean => {
  return (
    element.type === "rectangle" ||
    element.type === "ellipse" ||
    element.type === "diamond" ||
    isFrameLikeElement(element) ||
    (isLineElement(element) && element.polygon)
  );
};

/**
 * The label of an outline-only container sits inside its fill, so touching
 * the label must not erase the container.
 */
export const isEraserIgnoredLabel = (
  element: ExcalidrawElement,
  elementsMap: ElementsMap,
): boolean => {
  if (!isTextElement(element) || !element.containerId) {
    return false;
  }
  const container = elementsMap.get(element.containerId);
  return !!container && isEraserOutlineOnly(container);
};

/**
 * Filters a click hit the editor already found at `point`: drops protected
 * elements and labels inside shapes, and keeps an outline-only element only
 * when the click lands within `threshold` of its outline.
 */
export const isEraserClickHit = (
  point: GlobalPoint,
  element: ExcalidrawElement,
  elementsMap: ElementsMap,
  threshold: number,
): boolean => {
  if (
    isEraserProtected(element, elementsMap) ||
    isEraserIgnoredLabel(element, elementsMap)
  ) {
    return false;
  }
  return (
    !isEraserOutlineOnly(element) ||
    distanceToElement(element, elementsMap, point) <= threshold
  );
};

export type EraserOutcome = "delete" | "detachFromFrame" | null;

/**
 * What committing an erase does to `element`, given the ids the eraser marked.
 * Erasing a frame erases its children and erasing a container its label,
 * except for protected elements, which leave the erased frame instead.
 */
export const getEraserOutcome = (
  element: ExcalidrawElement,
  pendingIds: ReadonlySet<ExcalidrawElement["id"]>,
  elementsMap: ElementsMap,
): EraserOutcome => {
  const frameErased = !!element.frameId && pendingIds.has(element.frameId);

  if (isEraserProtected(element, elementsMap)) {
    return frameErased ? "detachFromFrame" : null;
  }
  if (
    pendingIds.has(element.id) ||
    frameErased ||
    (isBoundToContainer(element) && pendingIds.has(element.containerId))
  ) {
    return "delete";
  }
  return null;
};
