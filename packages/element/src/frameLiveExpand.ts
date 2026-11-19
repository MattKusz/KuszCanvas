/**
 * Pure geometry for a frame that grows to fit what is dragged (or drawn) into
 * it: the box it grows to, the zone in which it keeps following the pointer,
 * and the easing of its animation. Timers, animation frames and scene updates
 * live with the caller (the editor's live-expand controller).
 */
import { PRECISION } from "@excalidraw/math";

import type { Bounds } from "@excalidraw/common";

import { getElementBounds } from "./bounds";
import { getBoundTextElement } from "./textElement";
import { isFrameLikeElement } from "./typeChecks";

import type {
  ElementsMap,
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
} from "./types";

/** How long something must reach past a frame before the frame grows. */
export const FRAME_EXPAND_DWELL_MS = 300;

/** Duration of one grow/return animation of a frame under a drag. */
export const FRAME_EXPAND_ANIMATION_MS = 180;

/** Easing of a frame following a freehand stroke: short, to keep up. */
export const FRAME_FREEDRAW_ANIMATION_MS = 60;

/**
 * How far the dragged selection may overhang the frame's ORIGINAL box while
 * the frame keeps following, as a share of the selection's own width
 * (left/right) and height (top/bottom), each axis on its own. At 0.5 the
 * frame lets go once the selection's centre leaves the original box. Past
 * it, the frame returns to its original size and the drop does not join.
 * Scene units: zoom-independent.
 */
export const FRAME_FOLLOW_ZONE_RATIO = 0.5;

/** A frame's axis-aligned box, with non-negative width and height. */
export type FrameBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Point = { x: number; y: number };

const assertBox = (box: FrameBox, fn: string) => {
  if (
    !box ||
    ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
    box.width < 0 ||
    box.height < 0
  ) {
    throw new Error(
      `${fn}: expected a box with finite x/y and non-negative width/height`,
    );
  }
};

const assertPoint = (point: Point, fn: string) => {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error(`${fn}: expected a point with finite x/y`);
  }
};

/** The frame's box, normalised (a frame mid-creation may be negative). */
export const getFrameBox = (frame: ExcalidrawFrameLikeElement): FrameBox => {
  if (!frame || !isFrameLikeElement(frame)) {
    throw new Error("getFrameBox: expected a frame element");
  }
  if (![frame.x, frame.y, frame.width, frame.height].every(Number.isFinite)) {
    throw new Error(`getFrameBox: frame ${frame.id} has non-finite geometry`);
  }
  return {
    x: Math.min(frame.x, frame.x + frame.width),
    y: Math.min(frame.y, frame.y + frame.height),
    width: Math.abs(frame.width),
    height: Math.abs(frame.height),
  };
};

/**
 * The box grown to fit the bounds. Expand only: a side moves only where some
 * bounds pass it, and then to those bounds plus `padding`; every other side
 * stays, so the result always contains the box. Bounds snapped to an edge
 * (within PRECISION) do not count as passing it.
 */
export const growFrameBoxToFit = (
  box: FrameBox,
  bounds: readonly Bounds[],
  padding: number,
): FrameBox => {
  assertBox(box, "growFrameBoxToFit");
  if (!Array.isArray(bounds)) {
    throw new Error("growFrameBoxToFit: expected an array of bounds");
  }
  if (!Number.isFinite(padding) || padding < 0) {
    throw new Error(
      `growFrameBoxToFit: padding must be a finite number >= 0, got ${padding}`,
    );
  }

  const bx1 = box.x;
  const by1 = box.y;
  const bx2 = box.x + box.width;
  const by2 = box.y + box.height;
  let x1 = bx1;
  let y1 = by1;
  let x2 = bx2;
  let y2 = by2;

  for (const b of bounds) {
    if (!b || b.length !== 4 || !b.every(Number.isFinite)) {
      throw new Error("growFrameBoxToFit: bounds must be 4 finite numbers");
    }
    const [ex1, ey1, ex2, ey2] = b;
    if (ex1 < bx1 - PRECISION) {
      x1 = Math.min(x1, ex1 - padding);
    }
    if (ey1 < by1 - PRECISION) {
      y1 = Math.min(y1, ey1 - padding);
    }
    if (ex2 > bx2 + PRECISION) {
      x2 = Math.max(x2, ex2 + padding);
    }
    if (ey2 > by2 + PRECISION) {
      y2 = Math.max(y2, ey2 + padding);
    }
  }

  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
};

/**
 * The rotated bounds a frame must fit for these elements: each non-deleted,
 * non-frame element plus its bound text (a label is fitted even when only its
 * container is passed).
 */
export const getElementsFitBounds = (
  elements: readonly ExcalidrawElement[],
  elementsMap: ElementsMap,
): Bounds[] => {
  if (!Array.isArray(elements as unknown)) {
    throw new Error("getElementsFitBounds: expected an array of elements");
  }
  if (!elementsMap || typeof elementsMap.get !== "function") {
    throw new Error("getElementsFitBounds: expected an elements map");
  }
  const fitted = new Map<ExcalidrawElement["id"], ExcalidrawElement>();
  for (const element of elements) {
    if (!element || element.isDeleted || isFrameLikeElement(element)) {
      continue;
    }
    fitted.set(element.id, element);
    const boundText = getBoundTextElement(element, elementsMap);
    if (boundText && !boundText.isDeleted) {
      fitted.set(boundText.id, boundText);
    }
  }
  return [...fitted.values()].map((element) =>
    getElementBounds(element, elementsMap),
  );
};

/** Whether the point is in the box, edges included. */
export const isPointInFrameBox = (point: Point, box: FrameBox): boolean => {
  assertPoint(point, "isPointInFrameBox");
  assertBox(box, "isPointInFrameBox");
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
};

/**
 * Whether a dragged selection with these bounds is within the follow zone of
 * a frame whose original box is given: it overhangs the left or right edge by
 * no more than `ratio` × its own width, and the top or bottom edge by no more
 * than `ratio` × its own height, each axis measured on its own.
 */
export const isSelectionInFrameFollowZone = (
  selection: Bounds,
  originalBox: FrameBox,
  ratio: number,
): boolean => {
  if (
    !selection ||
    selection.length !== 4 ||
    !selection.every(Number.isFinite)
  ) {
    throw new Error(
      "isSelectionInFrameFollowZone: bounds must be 4 finite numbers",
    );
  }
  assertBox(originalBox, "isSelectionInFrameFollowZone");
  if (!Number.isFinite(ratio) || ratio < 0) {
    throw new Error(
      `isSelectionInFrameFollowZone: ratio must be a finite number >= 0, got ${ratio}`,
    );
  }
  const [x1, y1, x2, y2] = selection;
  const reachX = (x2 - x1) * ratio;
  const reachY = (y2 - y1) * ratio;
  return (
    originalBox.x - x1 <= reachX &&
    x2 - (originalBox.x + originalBox.width) <= reachX &&
    originalBox.y - y1 <= reachY &&
    y2 - (originalBox.y + originalBox.height) <= reachY
  );
};

/** The union of the bounds, or null for none. */
export const unionBounds = (bounds: readonly Bounds[]): Bounds | null => {
  if (!bounds.length) {
    return null;
  }
  return [
    Math.min(...bounds.map((b) => b[0])),
    Math.min(...bounds.map((b) => b[1])),
    Math.max(...bounds.map((b) => b[2])),
    Math.max(...bounds.map((b) => b[3])),
  ];
};

/** Ease-out cubic on progress 0..1 (values outside are clamped). */
export const easeOutCubic = (progress: number): number => {
  if (Number.isNaN(progress)) {
    throw new Error("easeOutCubic: progress must be a number");
  }
  const t = Math.min(1, Math.max(0, progress));
  return 1 - Math.pow(1 - t, 3);
};

/** The box `progress` (0..1) of the way from `from` to `to`. */
export const interpolateFrameBox = (
  from: FrameBox,
  to: FrameBox,
  progress: number,
): FrameBox => {
  assertBox(from, "interpolateFrameBox");
  assertBox(to, "interpolateFrameBox");
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new Error(
      `interpolateFrameBox: progress must be within 0..1, got ${progress}`,
    );
  }
  if (progress === 1) {
    return { ...to };
  }
  const lerp = (a: number, b: number) => a + (b - a) * progress;
  return {
    x: lerp(from.x, to.x),
    y: lerp(from.y, to.y),
    width: lerp(from.width, to.width),
    height: lerp(from.height, to.height),
  };
};

export const frameBoxesEqual = (a: FrameBox, b: FrameBox): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

export type FrameDropInput = {
  /** a drag of existing elements, or a freehand stroke being drawn */
  kind: "drag" | "freedraw";
  /**
   * the frame engaged and its dwell has passed — or no dwell applies (see
   * `frameDwellApplies`)
   */
  dwellElapsed: boolean;
  /** the dragged selection is within the frame's follow zone */
  inZone: boolean;
  /** some dragged element was already in this frame when the drag started */
  hasMembers: boolean;
  /** some dragged element was not in this frame */
  hasOutsiders: boolean;
};

export type FrameDropDecision = {
  /** the frame is the drop target: highlighted, and members stay in it */
  joins: boolean;
  /** elements not yet in the frame are added to it */
  admitsNewMembers: boolean;
  /** what the frame's final box fits: nothing new, its existing children, or all */
  size: "original" | "members" | "all";
  /** newcomers dropped before the dwell are put on top of the frame */
  outsidersOnTop: boolean;
};

/**
 * Whether a frame waits FRAME_EXPAND_DWELL_MS before it follows: only for
 * newcomers. A frame's own children (and a stroke started in it) make it
 * grow at once.
 */
export const frameDwellApplies = (input: { hasOutsiders: boolean }) => {
  if (!input || typeof input.hasOutsiders !== "boolean") {
    throw new Error("frameDwellApplies: hasOutsiders must be a boolean");
  }
  return input.hasOutsiders;
};

/**
 * What a drop does with the frame under a live expand — and so what the
 * preview shows while dragging.
 * - A freehand stroke stays in the frame it started in.
 * - Past the follow zone, nothing joins and the frame returns.
 * - After the dwell (or with no dwell: children only), everything joins.
 * - Before the dwell, children stay in and newcomers land on top.
 */
export const getFrameDropDecision = (
  input: FrameDropInput,
): FrameDropDecision => {
  if (!input || (input.kind !== "drag" && input.kind !== "freedraw")) {
    throw new Error(
      `getFrameDropDecision: kind must be "drag" or "freedraw", got ${input?.kind}`,
    );
  }
  for (const key of [
    "dwellElapsed",
    "inZone",
    "hasMembers",
    "hasOutsiders",
  ] as const) {
    if (typeof input[key] !== "boolean") {
      throw new Error(`getFrameDropDecision: ${key} must be a boolean`);
    }
  }

  const all = {
    joins: true,
    admitsNewMembers: true,
    size: "all",
    outsidersOnTop: false,
  } as const;
  if (input.kind === "freedraw") {
    return all;
  }
  if (!input.inZone) {
    return {
      joins: false,
      admitsNewMembers: false,
      size: "original",
      outsidersOnTop: false,
    };
  }
  if (input.dwellElapsed) {
    return all;
  }
  if (input.hasMembers) {
    return {
      joins: true,
      admitsNewMembers: false,
      size: "members",
      outsidersOnTop: input.hasOutsiders,
    };
  }
  return {
    joins: false,
    admitsNewMembers: false,
    size: "original",
    outsidersOnTop: input.hasOutsiders,
  };
};

/**
 * Pure: the z-order with the given elements that sit below the frame moved
 * to just above it (keeping their relative order), so an element dropped on
 * top of a frame is drawn over it, its fill included. Elements already above
 * the frame stay. Returns the same array when nothing moves.
 */
export const placeElementsAboveFrame = <T extends ExcalidrawElement>(
  elements: readonly T[],
  elementIds: ReadonlySet<ExcalidrawElement["id"]>,
  frameId: ExcalidrawFrameLikeElement["id"],
): { elements: readonly T[]; moved: T[] } => {
  if (!Array.isArray(elements as unknown)) {
    throw new Error("placeElementsAboveFrame: expected an array of elements");
  }
  if (!elementIds || typeof elementIds.has !== "function") {
    throw new Error("placeElementsAboveFrame: expected a set of element ids");
  }
  const frameIndex = elements.findIndex((element) => element.id === frameId);
  if (frameIndex === -1) {
    throw new Error(`placeElementsAboveFrame: frame ${frameId} not found`);
  }
  const moved = elements
    .slice(0, frameIndex)
    .filter((element) => elementIds.has(element.id));
  if (!moved.length) {
    return { elements, moved };
  }
  const movedSet = new Set(moved);
  const rest = elements.filter((element) => !movedSet.has(element));
  const insertAt = rest.findIndex((element) => element.id === frameId) + 1;
  return {
    elements: [...rest.slice(0, insertAt), ...moved, ...rest.slice(insertAt)],
    moved,
  };
};
