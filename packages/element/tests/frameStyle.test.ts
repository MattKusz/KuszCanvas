import { FRAME_STYLE, ROUNDNESS } from "@excalidraw/common";

import {
  FRAME_SHAPE_STYLE,
  getCurrentItemFrameShapeStyle,
  getFrameCreationStyle,
  getFrameDrawableForPass,
  getFrameFillAnchors,
  isShapeStyledFrame,
  isStylableFrame,
  isStylableFrameTool,
  markFrameStyleChange,
  resolveFrameRenderStyle,
} from "../src/frameStyle";
import {
  newElement,
  newFrameElement,
  newMagicFrameElement,
} from "../src/newElement";

import type { ExcalidrawElement, ExcalidrawFrameElement } from "../src/types";

import type { Drawable } from "roughjs/bin/core";

const CURRENT_ITEM = {
  strokeColor: "#1e1e1e",
  backgroundColor: "#ffc9c9",
  fillStyle: "hachure",
  strokeWidth: 4,
  strokeStyle: "dashed",
  roughness: 2,
  roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
} as const;

const HOST_FRAME_COLOR = {
  stroke: "#123456",
  fill: "rgba(1, 2, 3, 0.2)",
  nameColor: "#654321",
};

const legacyFrame = (
  overrides: Partial<ExcalidrawFrameElement> = {},
): ExcalidrawFrameElement => ({
  ...newFrameElement({ x: 0, y: 0, width: 100, height: 80, ...FRAME_STYLE }),
  ...overrides,
});

const shapeFrame = (
  overrides: Partial<ExcalidrawFrameElement> = {},
): ExcalidrawFrameElement => ({
  ...newFrameElement({
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    ...CURRENT_ITEM,
    customData: { frameStyle: FRAME_SHAPE_STYLE },
  }),
  ...overrides,
});

describe("frame style predicates", () => {
  it("treats regular frames as stylable, marker frames and magic frames not", () => {
    expect(isStylableFrame(legacyFrame())).toBe(true);
    expect(isStylableFrame(legacyFrame({ frameRole: "marker" }))).toBe(false);
    expect(
      isStylableFrame(newMagicFrameElement({ x: 0, y: 0, ...FRAME_STYLE })),
    ).toBe(false);
    expect(isStylableFrame(newElement({ type: "rectangle", x: 0, y: 0 }))).toBe(
      false,
    );
    expect(isStylableFrame(null)).toBe(false);
  });

  it("only reports the shape flag on stylable frames", () => {
    expect(isShapeStyledFrame(shapeFrame())).toBe(true);
    expect(isShapeStyledFrame(legacyFrame())).toBe(false);
    // a marker frame keeps its dashed legacy look even if the flag is stored
    expect(isShapeStyledFrame(shapeFrame({ frameRole: "marker" }))).toBe(false);
  });

  it("recognises the stylable frame tool", () => {
    expect(isStylableFrameTool("frame", null)).toBe(true);
    expect(isStylableFrameTool("frame", "marker")).toBe(false);
    expect(isStylableFrameTool("magicframe", null)).toBe(false);
    expect(isStylableFrameTool("rectangle", null)).toBe(false);
  });
});

describe("getFrameCreationStyle", () => {
  it("gives a new regular frame the current-item styles and the shape flag", () => {
    expect(
      getFrameCreationStyle({
        type: "frame",
        frameRole: null,
        currentItemStyle: CURRENT_ITEM,
        hostFrameColor: HOST_FRAME_COLOR,
      }),
    ).toEqual({
      ...CURRENT_ITEM,
      customData: { frameStyle: FRAME_SHAPE_STYLE },
    });
  });

  it("keeps marker frames and magic frames on the legacy frame style", () => {
    const legacy = {
      strokeColor: FRAME_STYLE.strokeColor,
      backgroundColor: FRAME_STYLE.backgroundColor,
      fillStyle: FRAME_STYLE.fillStyle,
      strokeWidth: FRAME_STYLE.strokeWidth,
      strokeStyle: FRAME_STYLE.strokeStyle,
      roughness: FRAME_STYLE.roughness,
      roundness: FRAME_STYLE.roundness,
      customData: { frameColor: HOST_FRAME_COLOR },
    };
    expect(
      getFrameCreationStyle({
        type: "frame",
        frameRole: "marker",
        currentItemStyle: CURRENT_ITEM,
        hostFrameColor: HOST_FRAME_COLOR,
      }),
    ).toEqual(legacy);
    expect(
      getFrameCreationStyle({
        type: "magicframe",
        frameRole: null,
        currentItemStyle: CURRENT_ITEM,
        hostFrameColor: HOST_FRAME_COLOR,
      }),
    ).toEqual(legacy);
    const { customData, ...withoutHostColor } = legacy;
    expect(
      getFrameCreationStyle({
        type: "frame",
        frameRole: "marker",
        currentItemStyle: CURRENT_ITEM,
        hostFrameColor: null,
      }),
    ).toEqual(withoutHostColor);
  });

  it("rejects an incomplete current-item style", () => {
    expect(() =>
      getFrameCreationStyle({
        type: "frame",
        frameRole: null,
        currentItemStyle: { ...CURRENT_ITEM, strokeWidth: undefined } as any,
        hostFrameColor: null,
      }),
    ).toThrow(/strokeWidth/);
  });
});

describe("getCurrentItemFrameShapeStyle", () => {
  const appState = {
    currentItemStrokeColor: "#1e1e1e",
    currentItemBackgroundColor: "#ffc9c9",
    currentItemFillStyle: "hachure",
    currentItemStrokeWidthKey: "bold",
    currentItemStrokeWidth: 0,
    currentItemStrokeStyle: "dashed",
    currentItemRoughness: 2,
    currentItemRoundness: "round",
  } as const;

  it("reads the rectangle current-item styles", () => {
    expect(getCurrentItemFrameShapeStyle(appState)).toEqual({
      strokeColor: "#1e1e1e",
      backgroundColor: "#ffc9c9",
      fillStyle: "hachure",
      strokeWidth: 4,
      strokeStyle: "dashed",
      roughness: 2,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
    });
  });

  it("honours a custom-pen stroke width and sharp edges", () => {
    const style = getCurrentItemFrameShapeStyle({
      ...appState,
      currentItemStrokeWidth: 7,
      currentItemRoundness: "sharp",
    });
    expect(style.strokeWidth).toBe(7);
    expect(style.roundness).toBeNull();
  });
});

describe("resolveFrameRenderStyle", () => {
  it("uses a shape frame's own style", () => {
    expect(resolveFrameRenderStyle(shapeFrame(), HOST_FRAME_COLOR)).toEqual(
      CURRENT_ITEM,
    );
  });

  it("draws legacy frames with stored roughness/width but legacy colours", () => {
    const frame = legacyFrame({
      roughness: 1,
      strokeWidth: 3,
      // stored colours are ignored on legacy frames
      strokeColor: "#ff0000",
      backgroundColor: "#00ff00",
    });
    expect(resolveFrameRenderStyle(frame, HOST_FRAME_COLOR)).toEqual({
      strokeColor: HOST_FRAME_COLOR.stroke,
      backgroundColor: "transparent",
      fillStyle: frame.fillStyle,
      strokeWidth: 3,
      strokeStyle: frame.strokeStyle,
      roughness: 1,
      // the legacy 8px rounded outline
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: FRAME_STYLE.radius },
    });
  });

  it("resolves legacy stroke as customData.frameColor → host frameColor → #bbb", () => {
    const own = legacyFrame({
      customData: { frameColor: { ...HOST_FRAME_COLOR, stroke: "#abcdef" } },
    });
    expect(resolveFrameRenderStyle(own, HOST_FRAME_COLOR).strokeColor).toBe(
      "#abcdef",
    );
    expect(
      resolveFrameRenderStyle(legacyFrame(), HOST_FRAME_COLOR).strokeColor,
    ).toBe(HOST_FRAME_COLOR.stroke);
    expect(resolveFrameRenderStyle(legacyFrame(), null).strokeColor).toBe(
      FRAME_STYLE.strokeColor,
    );
  });

  it("keeps a legacy frame's stored roundness when it has one", () => {
    const roundness = { type: ROUNDNESS.PROPORTIONAL_RADIUS };
    expect(
      resolveFrameRenderStyle(legacyFrame({ roundness }), null).roundness,
    ).toEqual(roundness);
  });

  it("rejects non-stylable frames", () => {
    expect(() =>
      resolveFrameRenderStyle(legacyFrame({ frameRole: "marker" }), null),
    ).toThrow();
  });
});

describe("markFrameStyleChange", () => {
  it("sets the shape flag when a style property of a legacy frame changes", () => {
    const prev = legacyFrame({ customData: { frameColor: HOST_FRAME_COLOR } });
    const next = { ...prev, strokeWidth: 4 };
    const marked = markFrameStyleChange(prev, next);
    expect(marked.customData).toEqual({
      frameColor: HOST_FRAME_COLOR,
      frameStyle: FRAME_SHAPE_STYLE,
    });
    expect(marked.strokeWidth).toBe(4);
  });

  it.each([
    "strokeColor",
    "backgroundColor",
    "fillStyle",
    "strokeStyle",
    "roughness",
    "roundness",
    "opacity",
  ] as const)("treats %s as a style property", (key) => {
    const prev = legacyFrame();
    const value: Record<string, unknown> = {
      strokeColor: "#ff0000",
      backgroundColor: "#00ff00",
      fillStyle: "cross-hatch",
      strokeStyle: "dotted",
      roughness: 2,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
      opacity: 50,
    };
    const next = { ...prev, [key]: value[key] } as ExcalidrawElement;
    expect(markFrameStyleChange(prev, next).customData?.frameStyle).toBe(
      FRAME_SHAPE_STYLE,
    );
  });

  it("returns the same element when nothing style-related changed", () => {
    const prev = legacyFrame();
    const renamed = { ...prev, name: "Renamed" };
    expect(markFrameStyleChange(prev, renamed)).toBe(renamed);
    expect(markFrameStyleChange(prev, prev)).toBe(prev);
  });

  it("leaves marker frames, magic frames, shapes and already-flagged frames alone", () => {
    const marker = legacyFrame({ frameRole: "marker" });
    const markerNext = { ...marker, strokeWidth: 4 };
    expect(markFrameStyleChange(marker, markerNext)).toBe(markerNext);

    const rect = newElement({ type: "rectangle", x: 0, y: 0 });
    const rectNext = { ...rect, strokeWidth: 4 };
    expect(markFrameStyleChange(rect, rectNext)).toBe(rectNext);

    const flagged = shapeFrame();
    const flaggedNext = { ...flagged, strokeWidth: 1 };
    expect(markFrameStyleChange(flagged, flaggedNext)).toBe(flaggedNext);
  });
});

describe("getFrameDrawableForPass", () => {
  const drawable = {
    shape: "rectangle",
    options: { stroke: "#000", fill: "#fff" },
    sets: [
      { type: "fillSketch", ops: [] },
      { type: "path", ops: [] },
    ],
  } as unknown as Drawable;

  it("splits fill and stroke sets", () => {
    expect(
      getFrameDrawableForPass(drawable, "fill", null).sets.map((s) => s.type),
    ).toEqual(["fillSketch"]);
    expect(
      getFrameDrawableForPass(drawable, "stroke", null).sets.map((s) => s.type),
    ).toEqual(["path"]);
    expect(getFrameDrawableForPass(drawable, "full", null)).toBe(drawable);
  });

  it("overrides the stroke colour without touching the cached drawable", () => {
    const result = getFrameDrawableForPass(drawable, "full", "#bbb");
    expect(result.options.stroke).toBe("#bbb");
    expect(result.options.fill).toBe("#fff");
    expect(drawable.options.stroke).toBe("#000");
  });
});

describe("getFrameFillAnchors", () => {
  it("paints a filled shape frame's fill before its lowest child", () => {
    const frame = shapeFrame({ id: "frame" });
    const childA = {
      ...newElement({ type: "rectangle", x: 0, y: 0 }),
      id: "a",
      frameId: "frame",
    };
    const outsider = {
      ...newElement({ type: "rectangle", x: 0, y: 0 }),
      id: "outsider",
    };
    const childB = {
      ...newElement({ type: "rectangle", x: 0, y: 0 }),
      id: "b",
      frameId: "frame",
    };
    const anchors = getFrameFillAnchors([outsider, childA, childB, frame]);
    expect([...anchors.keys()]).toEqual(["a"]);
    expect(anchors.get("a")).toEqual([frame]);
  });

  it("leaves a filled frame with no child below it to paint in full", () => {
    const frame = shapeFrame({ id: "frame" });
    const above = {
      ...newElement({ type: "rectangle", x: 0, y: 0 }),
      id: "above",
      frameId: "frame",
    };
    expect(getFrameFillAnchors([frame]).size).toBe(0);
    expect(getFrameFillAnchors([frame, above]).size).toBe(0);
  });

  it("skips transparent, legacy and marker frames", () => {
    expect(
      getFrameFillAnchors([
        shapeFrame({ id: "t", backgroundColor: "transparent" }),
        legacyFrame({ id: "l", backgroundColor: "#ff0000" }),
        shapeFrame({ id: "m", frameRole: "marker" }),
      ]).size,
    ).toBe(0);
  });
});
