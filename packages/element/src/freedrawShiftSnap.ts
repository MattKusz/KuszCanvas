/**
 * Shift-constrained freehand (KuszCanvas whiteboard, CP3).
 *
 * While Shift is held during a freedraw stroke, every raw point after an
 * anchor is projected onto the anchor→pointer direction snapped to the
 * nearest 45°. Points keep their index (and any pressure component), so
 * perfect-freehand still derives thickness from pressure and point spacing.
 *
 * Pure logic only: App.tsx owns the event handling and scene mutation.
 */

import { pointFrom, type LocalPoint } from "@excalidraw/math";

/** The eight snap directions as exact unit vectors, indexed by angle / 45°. */
const SNAP_DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0],
  [Math.SQRT1_2, Math.SQRT1_2],
  [0, 1],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [-1, 0],
  [-Math.SQRT1_2, -Math.SQRT1_2],
  [0, -1],
  [Math.SQRT1_2, -Math.SQRT1_2],
];

const assertFinitePoint = (point: readonly number[], label: string) => {
  if (
    !Array.isArray(point) ||
    point.length < 2 ||
    !Number.isFinite(point[0]) ||
    !Number.isFinite(point[1])
  ) {
    throw new Error(`${label} must have finite x and y coordinates`);
  }
};

const getSnapDirection = (
  dx: number,
  dy: number,
): readonly [number, number] => {
  const step = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return SNAP_DIRECTIONS[((step % 8) + 8) % 8];
};

/**
 * Projects every point after `anchorIndex` onto the line from the anchor
 * towards the last point, snapped to 0/45/90°… The distance along that line
 * is clamped to [0, distance of the last point] and made non-decreasing, so
 * back-tracking cannot fold the line over itself. Points up to and including
 * the anchor are returned unchanged; components after x and y (pressure) are
 * kept. Returns a new array.
 */
export const snapFreedrawSegment = <P extends readonly number[]>(
  points: readonly P[],
  anchorIndex: number,
): P[] => {
  if (!Array.isArray(points) || points.length === 0) {
    throw new Error("snapFreedrawSegment: points must be a non-empty array");
  }
  if (
    !Number.isInteger(anchorIndex) ||
    anchorIndex < 0 ||
    anchorIndex >= points.length
  ) {
    throw new Error(
      `snapFreedrawSegment: anchorIndex ${anchorIndex} is outside 0..${
        points.length - 1
      }`,
    );
  }
  points.forEach((point, index) =>
    assertFinitePoint(point, `snapFreedrawSegment: points[${index}]`),
  );

  const result = points.slice();
  if (anchorIndex === points.length - 1) {
    return result;
  }

  const [ax, ay] = points[anchorIndex];
  const last = points[points.length - 1];
  const [ux, uy] = getSnapDirection(last[0] - ax, last[1] - ay);
  const end = Math.max(0, (last[0] - ax) * ux + (last[1] - ay) * uy);

  let previous = 0;
  for (let i = anchorIndex + 1; i < points.length; i++) {
    const point = points[i];
    const along = (point[0] - ax) * ux + (point[1] - ay) * uy;
    const clamped = Math.max(previous, Math.min(end, Math.max(0, along)));
    previous = clamped;
    // the tuple shape of P is preserved: x and y replaced, the rest kept
    result[i] = [
      ax + clamped * ux,
      ay + clamped * uy,
      ...point.slice(2),
    ] as unknown as P;
  }
  return result;
};

/** Per-stroke buffer for Shift-constrained freehand. */
export type FreedrawSnapState = {
  /** Index in the displayed points where the current Shift segment starts. */
  anchorIndex: number | null;
  /** Raw (unsnapped) pointer points after the anchor. */
  rawTail: LocalPoint[];
  /** The previous raw pointer point, for duplicate filtering. */
  lastRaw: LocalPoint | null;
};

export const createFreedrawSnapState = (): FreedrawSnapState => ({
  anchorIndex: null,
  rawTail: [],
  lastRaw: null,
});

/**
 * Adds one raw pointer point to a freedraw stroke.
 *
 * - Shift up: the point is appended as is (and any Shift segment is frozen).
 * - Shift goes down: the anchor is the current last displayed point.
 * - Shift held: the displayed tail after the anchor is rebuilt from the raw
 *   tail and snapped, so the segment follows the pointer direction.
 *
 * The returned points always have one more entry than `displayedPoints`
 * when `appended` is true, so a parallel pressures array stays aligned.
 * A point identical to the previous raw point is discarded (`appended`
 * false, inputs returned unchanged).
 */
export const appendFreedrawStrokePoint = (
  state: FreedrawSnapState,
  displayedPoints: readonly LocalPoint[],
  rawPoint: LocalPoint,
  shiftKey: boolean,
): { state: FreedrawSnapState; points: LocalPoint[]; appended: boolean } => {
  if (!state || !Array.isArray(state.rawTail)) {
    throw new Error("appendFreedrawStrokePoint: state is not a snap state");
  }
  if (!Array.isArray(displayedPoints) || displayedPoints.length === 0) {
    throw new Error(
      "appendFreedrawStrokePoint: displayedPoints must be a non-empty array",
    );
  }
  assertFinitePoint(rawPoint, "appendFreedrawStrokePoint: rawPoint");
  if (typeof shiftKey !== "boolean") {
    throw new Error("appendFreedrawStrokePoint: shiftKey must be a boolean");
  }
  if (
    state.anchorIndex !== null &&
    (!Number.isInteger(state.anchorIndex) ||
      state.anchorIndex < 0 ||
      state.anchorIndex >= displayedPoints.length)
  ) {
    throw new Error(
      `appendFreedrawStrokePoint: anchorIndex ${state.anchorIndex} is outside the displayed points`,
    );
  }

  const previousRaw =
    state.lastRaw ?? displayedPoints[displayedPoints.length - 1];
  if (previousRaw[0] === rawPoint[0] && previousRaw[1] === rawPoint[1]) {
    return { state, points: displayedPoints as LocalPoint[], appended: false };
  }

  const point = pointFrom<LocalPoint>(rawPoint[0], rawPoint[1]);

  if (!shiftKey) {
    return {
      state: { anchorIndex: null, rawTail: [], lastRaw: point },
      points: [...displayedPoints, point],
      appended: true,
    };
  }

  const anchorIndex = state.anchorIndex ?? displayedPoints.length - 1;
  const rawTail =
    state.anchorIndex === null ? [point] : [...state.rawTail, point];
  const snapped = snapFreedrawSegment(
    [...displayedPoints.slice(0, anchorIndex + 1), ...rawTail],
    anchorIndex,
  );

  return {
    state: { anchorIndex, rawTail, lastRaw: point },
    points: snapped.map((p) => pointFrom<LocalPoint>(p[0], p[1])),
    appended: true,
  };
};
