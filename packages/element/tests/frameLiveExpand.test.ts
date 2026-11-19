import { arrayToMap } from "@excalidraw/common";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import {
  easeOutCubic,
  FRAME_EXPAND_ANIMATION_MS,
  FRAME_EXPAND_DWELL_MS,
  FRAME_FOLLOW_ZONE_RATIO,
  frameBoxesEqual,
  getElementsFitBounds,
  getFrameDropDecision,
  getFrameBox,
  growFrameBoxToFit,
  interpolateFrameBox,
  isPointInFrameBox,
  isSelectionInFrameFollowZone,
  frameDwellApplies,
  FRAME_FREEDRAW_ANIMATION_MS,
  placeElementsAboveFrame,
} from "../src/frameLiveExpand";

import type { Bounds } from "@excalidraw/common";

import type {
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
} from "../src/types";

const box = { x: 0, y: 0, width: 400, height: 200 };

describe("live frame expand constants", () => {
  it("matches the agreed timings and follow zone", () => {
    expect(FRAME_EXPAND_DWELL_MS).toBe(300);
    expect(FRAME_EXPAND_ANIMATION_MS).toBeGreaterThanOrEqual(150);
    expect(FRAME_EXPAND_ANIMATION_MS).toBeLessThanOrEqual(200);
    // freehand: short enough for the frame to keep up with the pen
    expect(FRAME_FREEDRAW_ANIMATION_MS).toBeLessThanOrEqual(80);
    expect(FRAME_FOLLOW_ZONE_RATIO).toBe(0.5);
  });
});

describe("getFrameBox", () => {
  it("normalises negative extents", () => {
    const frame = API.createElement({
      type: "frame",
      x: 100,
      y: 50,
      width: -40,
      height: -20,
    }) as ExcalidrawFrameLikeElement;
    expect(getFrameBox(frame)).toEqual({ x: 60, y: 30, width: 40, height: 20 });
  });

  it("rejects a non-frame and non-finite geometry", () => {
    const rect = API.createElement({ type: "rectangle" }) as any;
    expect(() => getFrameBox(rect)).toThrow(/frame/);
    const frame = {
      ...API.createElement({ type: "frame" }),
      x: NaN,
    } as ExcalidrawFrameLikeElement;
    expect(() => getFrameBox(frame)).toThrow(/geometry/);
  });
});

describe("growFrameBoxToFit", () => {
  const PAD = 16;

  it("returns an equal box when everything fits", () => {
    expect(growFrameBoxToFit(box, [[10, 10, 50, 50]], PAD)).toEqual(box);
    expect(growFrameBoxToFit(box, [], PAD)).toEqual(box);
  });

  it("grows each passed side to the bounds plus padding, only that side", () => {
    expect(growFrameBoxToFit(box, [[350, 10, 450, 50]], PAD)).toEqual({
      x: 0,
      y: 0,
      width: 450 + PAD,
      height: 200,
    });
    expect(growFrameBoxToFit(box, [[-30, 10, 20, 50]], PAD)).toEqual({
      x: -30 - PAD,
      y: 0,
      width: 430 + PAD,
      height: 200,
    });
    expect(growFrameBoxToFit(box, [[10, -5, 20, 50]], PAD)).toEqual({
      x: 0,
      y: -5 - PAD,
      width: 400,
      height: 205 + PAD,
    });
    expect(growFrameBoxToFit(box, [[10, 150, 20, 260]], PAD)).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 260 + PAD,
    });
  });

  it("never shrinks below the box", () => {
    const grown = growFrameBoxToFit(box, [[-10, -10, 1, 1]], PAD);
    expect(grown.x + grown.width).toBe(400);
    expect(grown.y + grown.height).toBe(200);
  });

  it("does not grow for bounds snapped to an edge", () => {
    expect(growFrameBoxToFit(box, [[0, 0, 400, 200]], PAD)).toEqual(box);
  });

  it("validates its inputs", () => {
    expect(() => growFrameBoxToFit(box, [[0, 0, NaN, 1]], PAD)).toThrow(
      /bounds/,
    );
    expect(() => growFrameBoxToFit(box, [], -1)).toThrow(/padding/);
    expect(() => growFrameBoxToFit({ ...box, width: -1 }, [], PAD)).toThrow(
      /box/,
    );
  });
});

describe("getElementsFitBounds", () => {
  it("includes rotated bounds and each element's bound text", () => {
    const container = API.createElement({
      id: "box",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      angle: (Math.PI / 4) as ExcalidrawElement["angle"],
      boundElements: [{ id: "label", type: "text" }],
    });
    const label = API.createElement({
      id: "label",
      type: "text",
      x: 0,
      y: 90,
      width: 100,
      height: 200,
      containerId: "box",
    });
    const map = arrayToMap<ExcalidrawElement>([container, label]);
    const bounds = getElementsFitBounds([container], map);
    expect(bounds).toHaveLength(2);
    const reach = 50 * Math.SQRT2;
    expect(bounds[0][0]).toBeCloseTo(50 - reach);
    expect(bounds[0][2]).toBeCloseTo(50 + reach);
    // the label is fitted even though only the container was passed
    expect(Math.max(...bounds.map((b: Bounds) => b[3]))).toBeGreaterThan(
      50 + reach,
    );
  });

  it("skips deleted elements and frames", () => {
    const deleted = API.createElement({ type: "rectangle", isDeleted: true });
    const frame = API.createElement({ type: "frame" });
    expect(
      getElementsFitBounds(
        [deleted, frame],
        arrayToMap<ExcalidrawElement>([deleted, frame]),
      ),
    ).toEqual([]);
  });
});

describe("isPointInFrameBox", () => {
  it("includes the edges", () => {
    expect(isPointInFrameBox({ x: 0, y: 0 }, box)).toBe(true);
    expect(isPointInFrameBox({ x: 400, y: 200 }, box)).toBe(true);
    expect(isPointInFrameBox({ x: 400.5, y: 100 }, box)).toBe(false);
  });
});

describe("isSelectionInFrameFollowZone", () => {
  // original frame 400 x 200 at the origin
  const R = FRAME_FOLLOW_ZONE_RATIO;
  /** a selection of the given size with its left/top edge at (x, y) */
  const sel = (x: number, y: number, w: number, h: number): Bounds => [
    x,
    y,
    x + w,
    y + h,
  ];

  it("contains a selection inside the frame", () => {
    expect(isSelectionInFrameFollowZone(sel(10, 10, 50, 50), box, R)).toBe(
      true,
    );
  });

  it("allows up to half the selection's width over the left and right edges", () => {
    // 100 wide: may overhang 50
    expect(isSelectionInFrameFollowZone(sel(350, 10, 100, 50), box, R)).toBe(
      true,
    );
    expect(isSelectionInFrameFollowZone(sel(350.01, 10, 100, 50), box, R)).toBe(
      false,
    );
    expect(isSelectionInFrameFollowZone(sel(-50, 10, 100, 50), box, R)).toBe(
      true,
    );
    expect(isSelectionInFrameFollowZone(sel(-50.01, 10, 100, 50), box, R)).toBe(
      false,
    );
  });

  it("allows up to half the selection's height over the top and bottom edges", () => {
    // 60 high: may overhang 30
    expect(isSelectionInFrameFollowZone(sel(10, -30, 50, 60), box, R)).toBe(
      true,
    );
    expect(isSelectionInFrameFollowZone(sel(10, -30.01, 50, 60), box, R)).toBe(
      false,
    );
    expect(isSelectionInFrameFollowZone(sel(10, 170, 50, 60), box, R)).toBe(
      true,
    );
    expect(isSelectionInFrameFollowZone(sel(10, 170.01, 50, 60), box, R)).toBe(
      false,
    );
  });

  it("scales with the selection: a large object may overhang further", () => {
    // 40 px over the right edge: too far for a 60-wide note, fine for 300
    expect(isSelectionInFrameFollowZone(sel(380, 10, 60, 50), box, R)).toBe(
      false,
    );
    expect(isSelectionInFrameFollowZone(sel(140, 10, 300, 50), box, R)).toBe(
      true,
    );
  });

  it("uses width for left/right and height for top/bottom on a non-square object", () => {
    // 200 x 20: may overhang 100 sideways but only 10 vertically
    expect(isSelectionInFrameFollowZone(sel(300, 10, 200, 20), box, R)).toBe(
      true,
    );
    expect(isSelectionInFrameFollowZone(sel(100, 189, 200, 20), box, R)).toBe(
      true,
    );
    expect(isSelectionInFrameFollowZone(sel(100, 191, 200, 20), box, R)).toBe(
      false,
    );
  });

  it("is the selection's centre staying in the original box at ratio 0.5", () => {
    expect(isSelectionInFrameFollowZone(sel(380, 180, 40, 40), box, R)).toBe(
      true,
    );
    expect(isSelectionInFrameFollowZone(sel(380, 181, 40, 40), box, R)).toBe(
      false,
    );
  });

  it("validates its inputs", () => {
    expect(() => isSelectionInFrameFollowZone([0, 0, NaN, 1], box, R)).toThrow(
      /bounds/,
    );
    expect(() =>
      isSelectionInFrameFollowZone(sel(0, 0, 1, 1), box, -0.1),
    ).toThrow(/ratio/);
  });
});

describe("easeOutCubic", () => {
  it("starts at 0, ends at 1 and is front-loaded", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });

  it("clamps progress outside 0..1 and rejects NaN", () => {
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
    expect(() => easeOutCubic(NaN)).toThrow(/progress/);
  });
});

describe("interpolateFrameBox", () => {
  const to = { x: -20, y: 0, width: 500, height: 300 };

  it("returns the endpoints at 0 and 1", () => {
    expect(interpolateFrameBox(box, to, 0)).toEqual(box);
    expect(interpolateFrameBox(box, to, 1)).toEqual(to);
  });

  it("interpolates every field linearly", () => {
    expect(interpolateFrameBox(box, to, 0.5)).toEqual({
      x: -10,
      y: 0,
      width: 450,
      height: 250,
    });
  });

  it("rejects progress outside 0..1", () => {
    expect(() => interpolateFrameBox(box, to, 1.5)).toThrow(/progress/);
  });
});

describe("frameBoxesEqual", () => {
  it("compares all four fields", () => {
    expect(frameBoxesEqual(box, { ...box })).toBe(true);
    expect(frameBoxesEqual(box, { ...box, height: 201 })).toBe(false);
  });
});

describe("getFrameDropDecision", () => {
  const newcomer = {
    kind: "drag" as const,
    dwellElapsed: false,
    inZone: true,
    hasMembers: false,
    hasOutsiders: true,
  };
  const NONE = {
    joins: false,
    admitsNewMembers: false,
    size: "original",
    outsidersOnTop: false,
  };

  it("needs the dwell for newcomers only", () => {
    expect(frameDwellApplies({ hasOutsiders: true })).toBe(true);
    expect(frameDwellApplies({ hasOutsiders: false })).toBe(false);
  });

  it("a quick drop of a newcomer lands on top: no join, frame unchanged", () => {
    expect(getFrameDropDecision(newcomer)).toEqual({
      ...NONE,
      outsidersOnTop: true,
    });
  });

  it("a drop of a newcomer after the dwell joins, fitted", () => {
    expect(getFrameDropDecision({ ...newcomer, dwellElapsed: true })).toEqual({
      joins: true,
      admitsNewMembers: true,
      size: "all",
      outsidersOnTop: false,
    });
  });

  it("an existing child stays in, fitted (no dwell needed)", () => {
    expect(
      getFrameDropDecision({
        ...newcomer,
        dwellElapsed: true, // the controller passes true: no dwell applies
        hasMembers: true,
        hasOutsiders: false,
      }),
    ).toEqual({
      joins: true,
      admitsNewMembers: true,
      size: "all",
      outsidersOnTop: false,
    });
  });

  it("a quick drop of children with newcomers keeps the children, newcomers on top", () => {
    expect(getFrameDropDecision({ ...newcomer, hasMembers: true })).toEqual({
      joins: true,
      admitsNewMembers: false,
      size: "members",
      outsidersOnTop: true,
    });
  });

  it("a drop past the zone joins nothing and restores the frame", () => {
    for (const dwellElapsed of [false, true]) {
      for (const hasMembers of [false, true]) {
        expect(
          getFrameDropDecision({
            ...newcomer,
            dwellElapsed,
            hasMembers,
            hasOutsiders: !hasMembers,
            inZone: false,
          }),
        ).toEqual(NONE);
      }
    }
  });

  it("a freehand stroke always stays in the frame it started in", () => {
    expect(
      getFrameDropDecision({
        ...newcomer,
        kind: "freedraw",
        inZone: false,
        hasMembers: true,
        hasOutsiders: false,
      }),
    ).toEqual({
      joins: true,
      admitsNewMembers: true,
      size: "all",
      outsidersOnTop: false,
    });
  });

  it("validates its input", () => {
    expect(() =>
      getFrameDropDecision({ ...newcomer, kind: "other" as any }),
    ).toThrow(/kind/);
    expect(() =>
      getFrameDropDecision({ ...newcomer, dwellElapsed: undefined as any }),
    ).toThrow(/dwellElapsed/);
  });
});

describe("placeElementsAboveFrame", () => {
  const els = (ids: string[]) => ids.map((id) => ({ id } as ExcalidrawElement));
  const ids = (list: readonly ExcalidrawElement[]) => list.map((e) => e.id);

  it("moves elements below the frame to just above it, keeping their order", () => {
    const list = els(["a", "note", "b", "label", "frame", "c"]);
    const result = placeElementsAboveFrame(
      list,
      new Set(["note", "label"]),
      "frame",
    );
    expect(ids(result.elements)).toEqual([
      "a",
      "b",
      "frame",
      "note",
      "label",
      "c",
    ]);
    expect(ids(result.moved)).toEqual(["note", "label"]);
  });

  it("leaves elements already above the frame where they are", () => {
    const list = els(["frame", "x", "note"]);
    const result = placeElementsAboveFrame(list, new Set(["note"]), "frame");
    expect(result.elements).toBe(list);
    expect(result.moved).toEqual([]);
  });

  it("rejects a missing frame", () => {
    expect(() =>
      placeElementsAboveFrame(els(["a"]), new Set(["a"]), "frame"),
    ).toThrow(/frame/);
  });
});
