import { arrayToMap } from "@excalidraw/common";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import {
  addElementsToFrame,
  expandFramesToFitElements,
  expandFrameToFitElements,
  FRAME_AUTO_EXPAND_PADDING,
} from "../src/frame";
import { getElementBounds } from "../src/bounds";
import { syncInvalidIndices } from "../src/fractionalIndex";
import { Scene } from "../src/Scene";

import type {
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
} from "../src/types";

const PAD = FRAME_AUTO_EXPAND_PADDING;

const makeFrame = (
  overrides: Partial<ExcalidrawFrameLikeElement> = {},
): ExcalidrawFrameLikeElement =>
  ({
    ...API.createElement({
      id: "frame",
      type: "frame",
      x: 0,
      y: 0,
      width: 200,
      height: 100,
    }),
    ...overrides,
  } as ExcalidrawFrameLikeElement);

const child = (
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  extra: Partial<ExcalidrawElement> = {},
) =>
  ({
    ...API.createElement({
      id,
      type: "rectangle",
      x,
      y,
      width,
      height,
      frameId: "frame",
    }),
    ...extra,
  } as ExcalidrawElement);

const expand = (
  frame: ExcalidrawFrameLikeElement,
  children: ExcalidrawElement[],
) =>
  expandFrameToFitElements(
    frame,
    arrayToMap<ExcalidrawElement>([frame, ...children]),
    PAD,
  );

describe("expandFrameToFitElements", () => {
  it("uses 16 px padding", () => {
    expect(FRAME_AUTO_EXPAND_PADDING).toBe(16);
  });

  it("returns null when every child is inside the frame", () => {
    expect(expand(makeFrame(), [child("a", 10, 10, 50, 50)])).toBeNull();
  });

  it("returns null for a child snapped exactly to the frame's edges", () => {
    expect(expand(makeFrame(), [child("a", 0, 0, 200, 100)])).toBeNull();
  });

  it("returns null for a frame without children", () => {
    expect(expand(makeFrame(), [])).toBeNull();
  });

  it("grows the right edge to the child plus padding", () => {
    expect(expand(makeFrame(), [child("a", 150, 10, 100, 50)])).toEqual({
      x: 0,
      y: 0,
      width: 250 + PAD,
      height: 100,
    });
  });

  it("grows the left edge to the child minus padding", () => {
    expect(expand(makeFrame(), [child("a", -40, 10, 100, 50)])).toEqual({
      x: -40 - PAD,
      y: 0,
      width: 240 + PAD,
      height: 100,
    });
  });

  it("grows the top edge to the child minus padding", () => {
    expect(expand(makeFrame(), [child("a", 10, -30, 50, 50)])).toEqual({
      x: 0,
      y: -30 - PAD,
      width: 200,
      height: 130 + PAD,
    });
  });

  it("grows the bottom edge to the child plus padding", () => {
    expect(expand(makeFrame(), [child("a", 10, 80, 50, 50)])).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 130 + PAD,
    });
  });

  it("grows only the sides a child exceeds, not sides a child is near", () => {
    // "near" sits 5 px inside the left edge: within the padding but not over it
    expect(
      expand(makeFrame(), [
        child("near", 5, 10, 20, 20),
        child("over", 190, 10, 30, 20),
      ]),
    ).toEqual({ x: 0, y: 0, width: 220 + PAD, height: 100 });
  });

  it("grows to the union of several overflowing children", () => {
    expect(
      expand(makeFrame(), [
        child("a", -20, -10, 30, 30),
        child("b", 180, 90, 50, 40),
      ]),
    ).toEqual({
      x: -20 - PAD,
      y: -10 - PAD,
      width: 250 + 2 * PAD,
      height: 140 + 2 * PAD,
    });
  });

  it("uses a child's rotated bounds", () => {
    // 100x100 square centred at (150, 50): unrotated it fits within x 100..200,
    // rotated 45° its corners reach 50·√2 ≈ 70.7 from the centre
    const rotated = child("a", 100, 0, 100, 100, {
      angle: (Math.PI / 4) as ExcalidrawElement["angle"],
    });
    const result = expand(makeFrame(), [rotated]);
    const reach = 50 * Math.SQRT2;
    expect(result).not.toBeNull();
    expect(result!.x).toBeCloseTo(0);
    expect(result!.y).toBeCloseTo(50 - reach - PAD);
    expect(result!.x + result!.width).toBeCloseTo(150 + reach + PAD);
    expect(result!.y + result!.height).toBeCloseTo(50 + reach + PAD);
  });

  it("includes a child's bound text, even when the text lacks the frameId", () => {
    const container = child("box", 10, 10, 50, 50, {
      boundElements: [{ id: "label", type: "text" }],
    });
    const label = {
      ...API.createElement({
        id: "label",
        type: "text",
        x: 10,
        y: 40,
        width: 50,
        height: 90,
        containerId: "box",
      }),
      frameId: null,
    } as ExcalidrawElement;
    expect(expand(makeFrame(), [container, label])).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 130 + PAD,
    });
  });

  it("never shrinks: a frame larger than its children is unchanged", () => {
    const big = makeFrame({ x: -500, y: -500, width: 2000, height: 2000 });
    expect(expand(big, [child("a", 0, 0, 10, 10)])).toBeNull();
  });

  it("never shrinks the sides a child does not exceed", () => {
    const result = expand(makeFrame(), [child("a", 150, 40, 100, 10)]);
    expect(result!.x).toBe(0);
    expect(result!.y).toBe(0);
    expect(result!.height).toBe(100);
  });

  it("ignores deleted children and elements of other frames", () => {
    expect(
      expand(makeFrame(), [
        child("deleted", 500, 500, 10, 10, { isDeleted: true }),
        child("other", 500, 500, 10, 10, { frameId: "elsewhere" }),
      ]),
    ).toBeNull();
  });

  it("excludes locked frames", () => {
    expect(
      expand(makeFrame({ locked: true }), [child("a", 150, 10, 100, 50)]),
    ).toBeNull();
  });

  it("excludes marker frames", () => {
    expect(
      expand(makeFrame({ frameRole: "marker" } as any), [
        child("a", 150, 10, 100, 50),
      ]),
    ).toBeNull();
  });

  it("excludes deleted frames", () => {
    expect(
      expand(makeFrame({ isDeleted: true }), [child("a", 150, 10, 100, 50)]),
    ).toBeNull();
  });

  it("rejects a non-frame element", () => {
    const rect = child("rect", 0, 0, 10, 10) as any;
    expect(() =>
      expandFrameToFitElements(rect, arrayToMap([rect]), PAD),
    ).toThrow(/frame/);
  });

  it("rejects negative or non-finite padding", () => {
    const frame = makeFrame();
    const map = arrayToMap<ExcalidrawElement>([frame]);
    expect(() => expandFrameToFitElements(frame, map, -1)).toThrow(/padding/);
    expect(() => expandFrameToFitElements(frame, map, NaN)).toThrow(/padding/);
    expect(() => expandFrameToFitElements(frame, map, Infinity)).toThrow(
      /padding/,
    );
  });

  it("rejects a frame with non-finite geometry", () => {
    const frame = makeFrame({ width: NaN });
    expect(() =>
      expandFrameToFitElements(frame, arrayToMap([frame]), PAD),
    ).toThrow(/geometry/);
  });

  it("does not mutate the frame or its children", () => {
    const frame = makeFrame();
    const a = child("a", 150, 10, 100, 50);
    const before = JSON.stringify([frame, a]);
    expand(frame, [a]);
    expect(JSON.stringify([frame, a])).toBe(before);
  });
});

describe("expandFramesToFitElements (scene)", () => {
  const setup = () => {
    const frame = API.createElement({
      id: "frame",
      type: "frame",
      x: 0,
      y: 0,
      width: 200,
      height: 200,
    });
    // a tilted sticky note dropped over the frame's right edge
    const note = API.createElement({
      id: "note",
      type: "stickynote",
      x: 150,
      y: 50,
      width: 120,
      height: 120,
      angle: (Math.PI / 120) as ExcalidrawElement["angle"],
    });
    const scene = new Scene(syncInvalidIndices([frame, note]));
    return { scene, frame: scene.getElement("frame")!, note };
  };

  it("adds a dropped note to the frame and grows the frame around it", () => {
    const { scene, note } = setup();
    const noteBefore = { x: note.x, y: note.y, angle: note.angle };

    // what handleSelectionDragOnPointerUp does: membership, then expand
    scene.replaceAllElements(
      addElementsToFrame(
        scene.getElementsMapIncludingDeleted(),
        [scene.getElement("note")!],
        scene.getElement("frame") as ExcalidrawFrameLikeElement,
      ),
    );
    expandFramesToFitElements(["frame"], scene);

    const frame = scene.getElement("frame")!;
    const placed = scene.getElement("note")!;
    expect(placed.frameId).toBe("frame");
    // the note did not move
    expect({ x: placed.x, y: placed.y, angle: placed.angle }).toEqual(
      noteBefore,
    );
    // the frame now holds the note's rotated bounds plus padding on the
    // sides it passed, and kept the sides it did not
    const [, , nx2] = getElementBounds(
      placed,
      scene.getNonDeletedElementsMap(),
    );
    expect(frame.x).toBe(0);
    expect(frame.y).toBe(0);
    expect(frame.x + frame.width).toBeCloseTo(nx2 + PAD);
    expect(frame.height).toBe(200);
  });

  it("bumps the frame version once and only when it grows", () => {
    const { scene } = setup();
    const v0 = scene.getElement("frame")!.version;

    expandFramesToFitElements(["frame"], scene);
    // not yet a member: nothing to fit
    expect(scene.getElement("frame")!.version).toBe(v0);

    scene.replaceAllElements(
      addElementsToFrame(
        scene.getElementsMapIncludingDeleted(),
        [scene.getElement("note")!],
        scene.getElement("frame") as ExcalidrawFrameLikeElement,
      ),
    );
    expandFramesToFitElements(["frame", "frame", null, undefined], scene);
    const v1 = scene.getElement("frame")!.version;
    expect(v1).toBe(v0 + 1);

    // already fits: a second pass is a no-op
    expandFramesToFitElements(["frame"], scene);
    expect(scene.getElement("frame")!.version).toBe(v1);
  });

  it("ignores ids of missing elements and of non-frames", () => {
    const { scene } = setup();
    expect(() =>
      expandFramesToFitElements(["missing", "note"], scene),
    ).not.toThrow();
  });

  it("rejects a missing scene or frame-id list", () => {
    const { scene } = setup();
    expect(() => expandFramesToFitElements(["frame"], null as any)).toThrow(
      /scene/,
    );
    expect(() => expandFramesToFitElements(null as any, scene)).toThrow(
      /frame ids/,
    );
  });
});
