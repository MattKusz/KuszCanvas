import { FONT_FAMILY, ROUGHNESS, THEME } from "@excalidraw/common";

import {
  CHALK_LAYER_STRENGTH,
  CHALK_TILE_SIZE,
  CHALK_TILE_SCENE_SIZE,
  generateChalkNoise,
  getChalkGrainTransforms,
  getChalkJitter,
  getChalkTileOffset,
  getMarkdownOpChalkLayer,
  intersectDeviceRects,
  invertAffine,
  isBlackboardRender,
  isChalkElement,
  multiplyAffine,
  splitDrawableForChalk,
  transformRectToDeviceBounds,
} from "../src/blackboard";
import {
  newArrowElement,
  newElement,
  newEmbeddableElement,
  newFrameElement,
  newFreeDrawElement,
  newImageElement,
  newLinearElement,
  newMagicFrameElement,
  newStickyNoteElement,
  newTextElement,
} from "../src/newElement";

import type { MarkdownPaintOp } from "../src/markdownTextRender";

import type { Drawable } from "roughjs/bin/core";

const BASE = { x: 0, y: 0, width: 100, height: 60 };

const rect = (roughness: number) =>
  newElement({ type: "rectangle", ...BASE, roughness });

const text = (fontFamily: number, containerId: string | null = null) =>
  newTextElement({
    text: "chalk",
    fontFamily: fontFamily as any,
    containerId,
    ...BASE,
  });

describe("isBlackboardRender", () => {
  it("is on only in dark theme with the host flag set", () => {
    expect(isBlackboardRender(THEME.DARK, true)).toBe(true);
    expect(isBlackboardRender(THEME.DARK, false)).toBe(false);
    expect(isBlackboardRender(THEME.LIGHT, true)).toBe(false);
  });

  it("rejects an unknown theme", () => {
    expect(() => isBlackboardRender("sepia" as any, true)).toThrow(/theme/);
  });
});

describe("isChalkElement", () => {
  it("chalks sketchy shapes, lines and arrows but not architect ones", () => {
    for (const type of ["rectangle", "diamond", "ellipse"] as const) {
      expect(
        isChalkElement(
          newElement({ type, ...BASE, roughness: ROUGHNESS.artist }),
          null,
        ),
      ).toBe(true);
      expect(
        isChalkElement(
          newElement({ type, ...BASE, roughness: ROUGHNESS.architect }),
          null,
        ),
      ).toBe(false);
    }
    expect(
      isChalkElement(
        newLinearElement({ type: "line", ...BASE, roughness: 2 }),
        null,
      ),
    ).toBe(true);
    expect(
      isChalkElement(
        newArrowElement({ type: "arrow", ...BASE, roughness: 0 }),
        null,
      ),
    ).toBe(false);
    expect(
      isChalkElement(
        newArrowElement({ type: "arrow", ...BASE, roughness: 1 }),
        null,
      ),
    ).toBe(true);
  });

  it("always chalks freedraw, whatever its hidden roughness", () => {
    for (const roughness of [0, 1, 2]) {
      expect(
        isChalkElement(
          newFreeDrawElement({
            type: "freedraw",
            ...BASE,
            roughness,
            simulatePressure: false,
          }),
          null,
        ),
      ).toBe(true);
    }
  });

  it("chalks Excalifont text only", () => {
    expect(isChalkElement(text(FONT_FAMILY.Excalifont), null)).toBe(true);
    expect(isChalkElement(text(FONT_FAMILY.Nunito), null)).toBe(false);
    expect(isChalkElement(text(FONT_FAMILY["Lilita One"]), null)).toBe(false);
    expect(isChalkElement(text(FONT_FAMILY.Virgil), null)).toBe(false);
  });

  it("chalks Excalifont labels whatever the container's roughness", () => {
    const solid = rect(ROUGHNESS.architect);
    expect(isChalkElement(text(FONT_FAMILY.Excalifont, solid.id), solid)).toBe(
      true,
    );
  });

  it("never chalks text on a sticky note", () => {
    const note = newStickyNoteElement({ type: "stickynote", ...BASE });
    expect(isChalkElement(text(FONT_FAMILY.Excalifont, note.id), note)).toBe(
      false,
    );
  });

  it("never chalks sticky notes, images or embeds", () => {
    expect(
      isChalkElement(
        newStickyNoteElement({ type: "stickynote", ...BASE, roughness: 2 }),
        null,
      ),
    ).toBe(false);
    expect(
      isChalkElement(newImageElement({ type: "image", ...BASE }), null),
    ).toBe(false);
    expect(
      isChalkElement(
        newEmbeddableElement({ type: "embeddable", ...BASE, roughness: 2 }),
        null,
      ),
    ).toBe(false);
  });

  it("chalks sketchy regular frames, never marker or magic frames", () => {
    expect(
      isChalkElement(newFrameElement({ ...BASE, roughness: 1 }), null),
    ).toBe(true);
    expect(
      isChalkElement(newFrameElement({ ...BASE, roughness: 0 }), null),
    ).toBe(false);
    expect(
      isChalkElement(
        newFrameElement({ ...BASE, roughness: 2, frameRole: "marker" } as any),
        null,
      ),
    ).toBe(false);
    expect(
      isChalkElement(newMagicFrameElement({ ...BASE, roughness: 2 }), null),
    ).toBe(false);
  });

  it("rejects a missing element", () => {
    expect(() => isChalkElement(null as any, null)).toThrow(/element/);
  });
});

describe("splitDrawableForChalk", () => {
  const drawable = {
    shape: "rectangle",
    options: {} as Drawable["options"],
    sets: [
      { type: "fillSketch", ops: [] },
      { type: "fillPath", ops: [] },
      { type: "path", ops: [] },
    ],
  } as Drawable;

  it("puts outlines in the stroke layer and fills in the fill layer", () => {
    expect(
      splitDrawableForChalk(drawable, "stroke")!.sets.map((s) => s.type),
    ).toEqual(["path"]);
    expect(
      splitDrawableForChalk(drawable, "fill")!.sets.map((s) => s.type),
    ).toEqual(["fillSketch", "fillPath"]);
  });

  it("returns null when the layer has nothing, and for the solid layer", () => {
    const outline = { ...drawable, sets: [{ type: "path", ops: [] }] };
    expect(splitDrawableForChalk(outline as Drawable, "fill")).toBeNull();
    expect(splitDrawableForChalk(drawable, "solid")).toBeNull();
  });

  it("keeps the drawable's options", () => {
    expect(splitDrawableForChalk(drawable, "stroke")!.options).toBe(
      drawable.options,
    );
  });
});

describe("getMarkdownOpChalkLayer", () => {
  const rectOp = (role: string) =>
    ({
      kind: "rect",
      role,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      color: "#fff",
      alpha: 1,
      radius: 0,
    } as unknown as MarkdownPaintOp);
  const textOp = (code: boolean) =>
    ({
      kind: "text",
      text: "a",
      x: 0,
      y: 0,
      font: "20px Excalifont",
      color: "#fff",
      style: { code },
    } as unknown as MarkdownPaintOp);

  it("keeps code runs solid and chalks other text", () => {
    expect(getMarkdownOpChalkLayer(textOp(true))).toBe("solid");
    expect(getMarkdownOpChalkLayer(textOp(false))).toBe("stroke");
  });

  it("puts backgrounds in the fill layer and marks in the stroke layer", () => {
    expect(getMarkdownOpChalkLayer(rectOp("highlight"))).toBe("fill");
    expect(getMarkdownOpChalkLayer(rectOp("tag"))).toBe("fill");
    expect(getMarkdownOpChalkLayer(rectOp("tableHeader"))).toBe("fill");
    expect(getMarkdownOpChalkLayer(rectOp("code"))).toBe("solid");
    expect(getMarkdownOpChalkLayer(rectOp("decoration"))).toBe("stroke");
    expect(getMarkdownOpChalkLayer(rectOp("quote"))).toBe("stroke");
    expect(getMarkdownOpChalkLayer(rectOp("tableGrid"))).toBe("stroke");
    expect(
      getMarkdownOpChalkLayer({
        kind: "circle",
        cx: 0,
        cy: 0,
        r: 1,
        color: "#fff",
      }),
    ).toBe("stroke");
  });

  it("rejects a rect without a known role", () => {
    expect(() => getMarkdownOpChalkLayer(rectOp("mystery"))).toThrow(/role/);
  });
});

describe("generateChalkNoise", () => {
  const SIZE = CHALK_TILE_SIZE;

  it("is deterministic per seed", () => {
    expect(generateChalkNoise(SIZE, 7)).toEqual(generateChalkNoise(SIZE, 7));
    expect(generateChalkNoise(SIZE, 7)).not.toEqual(
      generateChalkNoise(SIZE, 8),
    );
  });

  it("returns one alpha per pixel within 0..255", () => {
    const noise = generateChalkNoise(SIZE, 1);
    expect(noise.length).toBe(SIZE * SIZE);
    expect(Math.min(...noise)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...noise)).toBeLessThanOrEqual(255);
  });

  it("erases a chalk-like share of the stroke: holes, but mostly solid", () => {
    const noise = generateChalkNoise(SIZE, 1);
    const mean = noise.reduce((sum, value) => sum + value, 0) / noise.length;
    // average erased fraction at full strength
    expect(mean / 255).toBeGreaterThan(0.2);
    expect(mean / 255).toBeLessThan(0.5);
    // real holes (nearly fully erased) and untouched grain both exist
    const holes = noise.filter((value) => value > 230).length / noise.length;
    const solid = noise.filter((value) => value < 25).length / noise.length;
    expect(holes).toBeGreaterThan(0.05);
    expect(solid).toBeGreaterThan(0.25);
  });

  it("tiles seamlessly: opposite edges continue each other", () => {
    const noise = generateChalkNoise(SIZE, 3);
    const at = (x: number, y: number) =>
      noise[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)];
    // the mean jump across the wrap seam is no larger than across any
    // interior column boundary (fine grain included)
    const columnJump = (x: number) => {
      let sum = 0;
      for (let y = 0; y < SIZE; y++) {
        sum += Math.abs(at(x, y) - at(x - 1, y));
      }
      return sum / SIZE;
    };
    let interior = 0;
    for (let x = 1; x < SIZE; x++) {
      interior += columnJump(x);
    }
    interior /= SIZE - 1;
    expect(columnJump(0)).toBeLessThan(interior * 1.5);
  });

  it("rejects a non-power-of-two or tiny size", () => {
    expect(() => generateChalkNoise(100, 1)).toThrow(/size/);
    expect(() => generateChalkNoise(8, 1)).toThrow(/size/);
  });
});

describe("per-element variation", () => {
  it("offsets the tile within one tile, deterministically", () => {
    for (const seed of [0, 1, 123456, 2 ** 31 - 1]) {
      const offset = getChalkTileOffset(seed);
      expect(offset).toEqual(getChalkTileOffset(seed));
      expect(offset.x).toBeGreaterThanOrEqual(0);
      expect(offset.x).toBeLessThan(1);
      expect(offset.y).toBeGreaterThanOrEqual(0);
      expect(offset.y).toBeLessThan(1);
    }
    expect(getChalkTileOffset(1)).not.toEqual(getChalkTileOffset(2));
  });

  it("jitters the second pass by a small scene distance", () => {
    for (const seed of [0, 5, 99999]) {
      const { dx, dy } = getChalkJitter(seed);
      const length = Math.hypot(dx, dy);
      expect(length).toBeGreaterThan(0.3);
      expect(length).toBeLessThan(1.2);
    }
  });

  it("weakens the grain on fills", () => {
    expect(CHALK_LAYER_STRENGTH.fill).toBeLessThan(CHALK_LAYER_STRENGTH.stroke);
    expect(CHALK_LAYER_STRENGTH.fill).toBeGreaterThan(0);
    expect(CHALK_LAYER_STRENGTH.stroke).toBeLessThanOrEqual(1);
  });
});

describe("affine helpers", () => {
  const m = { a: 2, b: 0, c: 0, d: 2, e: 10, f: 20 };

  it("maps a local rect to integer device bounds", () => {
    expect(
      transformRectToDeviceBounds(m, { x: 1, y: 1, width: 4.2, height: 3 }),
    ).toEqual({ x: 12, y: 22, width: 9, height: 6 });
  });

  it("covers a rotated rect with its axis-aligned bounds", () => {
    const rot = { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 }; // 90°
    expect(
      transformRectToDeviceBounds(rot, { x: 0, y: 0, width: 10, height: 4 }),
    ).toEqual({ x: -4, y: 0, width: 4, height: 10 });
  });

  it("inverts an affine transform", () => {
    const inv = invertAffine(m);
    expect(inv.a).toBeCloseTo(0.5);
    expect(inv.d).toBeCloseTo(0.5);
    expect(inv.e).toBeCloseTo(-5);
    expect(inv.f).toBeCloseTo(-10);
    expect(() => invertAffine({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 })).toThrow(
      /singular/,
    );
  });

  it("intersects device rects, null when disjoint", () => {
    expect(
      intersectDeviceRects(
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 5, y: -5, width: 10, height: 10 },
      ),
    ).toEqual({ x: 5, y: 0, width: 5, height: 5 });
    expect(
      intersectDeviceRects(
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 20, y: 0, width: 5, height: 5 },
      ),
    ).toBeNull();
  });

  it("multiplies transforms, applying the right one first", () => {
    const scale = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };
    const move = { a: 1, b: 0, c: 0, d: 1, e: 5, f: 7 };
    expect(multiplyAffine(scale, move)).toEqual({
      a: 2,
      b: 0,
      c: 0,
      d: 2,
      e: 10,
      f: 14,
    });
    expect(multiplyAffine(move, scale)).toEqual({
      a: 2,
      b: 0,
      c: 0,
      d: 2,
      e: 5,
      f: 7,
    });
  });
});

describe("getChalkGrainTransforms", () => {
  const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

  it("maps one tile onto CHALK_TILE_SCENE_SIZE local units in the first pass", () => {
    const [first] = getChalkGrainTransforms(identity, 1);
    expect(Math.hypot(first.transform.a, first.transform.b)).toBeCloseTo(
      CHALK_TILE_SCENE_SIZE / CHALK_TILE_SIZE,
    );
  });

  it("follows the layer transform (zoom scales the grain)", () => {
    const zoomed = { a: 3, b: 0, c: 0, d: 3, e: 0, f: 0 };
    const [plain] = getChalkGrainTransforms(identity, 1);
    const [scaled] = getChalkGrainTransforms(zoomed, 1);
    expect(scaled.transform.a).toBeCloseTo(plain.transform.a * 3);
  });

  it("rotates and rescales the second pass so the repeat breaks up", () => {
    const [first, second] = getChalkGrainTransforms(identity, 1);
    expect(second.transform.b).not.toBeCloseTo(0);
    expect(Math.hypot(second.transform.a, second.transform.b)).not.toBeCloseTo(
      Math.hypot(first.transform.a, first.transform.b),
    );
  });

  it("varies the grain origin by seed", () => {
    const a = getChalkGrainTransforms(identity, 1)[0].transform;
    const b = getChalkGrainTransforms(identity, 2)[0].transform;
    expect([a.e, a.f]).not.toEqual([b.e, b.f]);
  });
});
