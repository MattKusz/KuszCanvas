import { pointFrom, type LocalPoint } from "@excalidraw/math";

import {
  appendFreedrawStrokePoint,
  createFreedrawSnapState,
  snapFreedrawSegment,
} from "../src/freedrawShiftSnap";

const lp = (x: number, y: number) => pointFrom<LocalPoint>(x, y);

const expectPoint = (actual: readonly number[], x: number, y: number) => {
  expect(actual[0]).toBeCloseTo(x, 9);
  expect(actual[1]).toBeCloseTo(y, 9);
};

describe("snapFreedrawSegment", () => {
  it("snaps a near-horizontal segment to 0°", () => {
    const result = snapFreedrawSegment(
      [lp(0, 0), lp(5, 1), lp(10, 2), lp(20, 3)],
      0,
    );
    expect(result).toHaveLength(4);
    expectPoint(result[0], 0, 0);
    expectPoint(result[1], 5, 0);
    expectPoint(result[2], 10, 0);
    expectPoint(result[3], 20, 0);
  });

  it("snaps a ~40° segment to 45° (x === y)", () => {
    const result = snapFreedrawSegment([lp(0, 0), lp(10, 8), lp(20, 17)], 0);
    for (const point of result.slice(1)) {
      expect(point[0]).toBeCloseTo(point[1], 9);
    }
    // projection of (20, 17) onto the 45° unit vector
    const t = (20 + 17) * Math.SQRT1_2;
    expectPoint(result[2], t * Math.SQRT1_2, t * Math.SQRT1_2);
  });

  it("snaps a near-vertical segment to 90° with x exactly preserved", () => {
    const result = snapFreedrawSegment([lp(3, 4), lp(4, 14), lp(5, 34)], 0);
    expect(result[1][0]).toBe(3);
    expect(result[2][0]).toBe(3);
    expectPoint(result[1], 3, 14);
    expectPoint(result[2], 3, 34);
  });

  it("snaps leftwards and up-left directions", () => {
    const left = snapFreedrawSegment([lp(0, 0), lp(-20, 2)], 0);
    expectPoint(left[1], -20, 0);

    const upLeft = snapFreedrawSegment([lp(0, 0), lp(-20, -18)], 0);
    expect(upLeft[1][0]).toBeCloseTo(upLeft[1][1], 9);
    expect(upLeft[1][0]).toBeLessThan(0);
  });

  it("leaves points up to and including the anchor untouched", () => {
    const points = [lp(0, 0), lp(3, 7), lp(9, 2), lp(15, 4), lp(30, 5)];
    const result = snapFreedrawSegment(points, 2);
    expect(result[0]).toEqual(points[0]);
    expect(result[1]).toEqual(points[1]);
    expect(result[2]).toEqual(points[2]);
    // after the anchor (9, 2) the stroke runs horizontally
    expectPoint(result[3], 15, 2);
    expectPoint(result[4], 30, 2);
  });

  it("clamps back-tracking so the snapped line never folds back", () => {
    const result = snapFreedrawSegment(
      [lp(0, 0), lp(10, 0), lp(20, 0), lp(5, 0), lp(30, 0)],
      0,
    );
    const xs = result.map((point) => point[0]);
    expect(xs).toEqual([0, 10, 20, 20, 30]);
  });

  it("clamps overshoot to the current pointer and points behind the anchor to the anchor", () => {
    const result = snapFreedrawSegment(
      [lp(0, 0), lp(-5, 0), lp(40, 0), lp(25, 0)],
      0,
    );
    const xs = result.map((point) => point[0]);
    expect(xs).toEqual([0, 0, 25, 25]);
  });

  it("preserves pressure carried as a third component", () => {
    const result = snapFreedrawSegment(
      [
        [0, 0, 0.2],
        [5, 1, 0.4],
        [10, -1, 0.9],
      ],
      0,
    );
    expect(result.map((point) => point[2])).toEqual([0.2, 0.4, 0.9]);
    expectPoint(result[2], 10, 0);
  });

  it("collapses the tail onto the anchor when the pointer returns to it", () => {
    const result = snapFreedrawSegment([lp(2, 2), lp(8, 3), lp(2, 2)], 0);
    expectPoint(result[1], 2, 2);
    expectPoint(result[2], 2, 2);
  });

  it("returns an unchanged copy when the anchor is the last point", () => {
    const points = [lp(0, 0), lp(3, 9)];
    const result = snapFreedrawSegment(points, 1);
    expect(result).toEqual(points);
    expect(result).not.toBe(points);
  });

  it("rejects invalid input", () => {
    expect(() => snapFreedrawSegment([], 0)).toThrow(/points/);
    expect(() => snapFreedrawSegment([lp(0, 0)], -1)).toThrow(/anchorIndex/);
    expect(() => snapFreedrawSegment([lp(0, 0)], 1)).toThrow(/anchorIndex/);
    expect(() => snapFreedrawSegment([lp(0, 0), lp(1, 1)], 0.5)).toThrow(
      /anchorIndex/,
    );
    expect(() => snapFreedrawSegment([lp(0, 0), lp(NaN, 1)], 0)).toThrow(
      /finite/,
    );
    expect(() =>
      snapFreedrawSegment([[0] as unknown as LocalPoint], 0),
    ).toThrow(/finite/);
  });
});

describe("appendFreedrawStrokePoint", () => {
  it("appends raw points while Shift is up", () => {
    const state = createFreedrawSnapState();
    const step = appendFreedrawStrokePoint(state, [lp(0, 0)], lp(4, 3), false);
    expect(step.appended).toBe(true);
    expect(step.points).toEqual([lp(0, 0), lp(4, 3)]);
    expect(step.state.anchorIndex).toBeNull();
  });

  it("anchors at the current stroke end when Shift goes down and snaps what follows", () => {
    let state = createFreedrawSnapState();
    let points: LocalPoint[] = [lp(0, 0)];
    ({ state, points } = appendFreedrawStrokePoint(
      state,
      points,
      lp(5, 5),
      false,
    ));
    ({ state, points } = appendFreedrawStrokePoint(
      state,
      points,
      lp(10, 6),
      true,
    ));
    expect(state.anchorIndex).toBe(1);
    ({ state, points } = appendFreedrawStrokePoint(
      state,
      points,
      lp(25, 7),
      true,
    ));
    expect(points).toHaveLength(4);
    expect(points[1]).toEqual(lp(5, 5));
    expectPoint(points[2], 10, 5);
    expectPoint(points[3], 25, 5);
  });

  it("re-snaps the whole tail from raw input when the pointer changes direction", () => {
    let state = createFreedrawSnapState();
    let points: LocalPoint[] = [lp(0, 0)];
    ({ state, points } = appendFreedrawStrokePoint(
      state,
      points,
      lp(10, 1),
      true,
    ));
    expectPoint(points[1], 10, 0);
    // the pointer swings round to roughly 90°: the earlier tail point follows
    ({ state, points } = appendFreedrawStrokePoint(
      state,
      points,
      lp(2, 30),
      true,
    ));
    expectPoint(points[1], 0, 1);
    expectPoint(points[2], 0, 30);
  });

  it("freezes the snapped segment and resumes freehand when Shift is released", () => {
    let state = createFreedrawSnapState();
    let points: LocalPoint[] = [lp(0, 0)];
    ({ state, points } = appendFreedrawStrokePoint(
      state,
      points,
      lp(10, 2),
      true,
    ));
    ({ state, points } = appendFreedrawStrokePoint(
      state,
      points,
      lp(20, 3),
      true,
    ));
    ({ state, points } = appendFreedrawStrokePoint(
      state,
      points,
      lp(24, 9),
      false,
    ));
    expect(state.anchorIndex).toBeNull();
    expectPoint(points[1], 10, 0);
    expectPoint(points[2], 20, 0);
    expect(points[3]).toEqual(lp(24, 9));
  });

  it("starts a new anchor when Shift is pressed again", () => {
    let state = createFreedrawSnapState();
    let points: LocalPoint[] = [lp(0, 0)];
    ({ state, points } = appendFreedrawStrokePoint(
      state,
      points,
      lp(10, 1),
      true,
    ));
    ({ state, points } = appendFreedrawStrokePoint(
      state,
      points,
      lp(12, 9),
      false,
    ));
    ({ state, points } = appendFreedrawStrokePoint(
      state,
      points,
      lp(13, 20),
      true,
    ));
    expect(state.anchorIndex).toBe(2);
    expect(points[2]).toEqual(lp(12, 9));
    expectPoint(points[3], 12, 20);
  });

  it("discards a point identical to the previous raw input", () => {
    let state = createFreedrawSnapState();
    let points: LocalPoint[] = [lp(0, 0)];
    ({ state, points } = appendFreedrawStrokePoint(
      state,
      points,
      lp(10, 2),
      true,
    ));
    const step = appendFreedrawStrokePoint(state, points, lp(10, 2), true);
    expect(step.appended).toBe(false);
    expect(step.points).toBe(points);
    expect(step.state).toBe(state);
  });

  it("discards a first point identical to the stroke origin", () => {
    const state = createFreedrawSnapState();
    const step = appendFreedrawStrokePoint(state, [lp(0, 0)], lp(0, 0), false);
    expect(step.appended).toBe(false);
  });

  it("rejects invalid input", () => {
    const state = createFreedrawSnapState();
    expect(() => appendFreedrawStrokePoint(state, [], lp(1, 1), false)).toThrow(
      /displayedPoints/,
    );
    expect(() =>
      appendFreedrawStrokePoint(state, [lp(0, 0)], lp(NaN, 1), false),
    ).toThrow(/finite/);
    expect(() =>
      appendFreedrawStrokePoint(
        state,
        [lp(0, 0)],
        lp(1, 1),
        "yes" as unknown as boolean,
      ),
    ).toThrow(/shiftKey/);
    expect(() =>
      appendFreedrawStrokePoint(
        { anchorIndex: 5, rawTail: [], lastRaw: null },
        [lp(0, 0)],
        lp(1, 1),
        true,
      ),
    ).toThrow(/anchorIndex/);
  });
});
