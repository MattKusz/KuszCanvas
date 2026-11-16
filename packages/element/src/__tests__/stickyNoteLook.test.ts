import {
  DEFAULT_STICKY_NOTE_SIZE,
  ROUNDNESS,
  shiftColorTone,
} from "@excalidraw/common";
import tinycolor from "tinycolor2";

import { newStickyNoteElement } from "../newElement";
import { getCanvasPadding } from "../renderElement";
import {
  STICKY_NOTE_MAX_TILT,
  STICKY_NOTE_VARIATION_LIMITS,
  getStickyNoteCornerRadius,
  getStickyNoteCreationAngle,
  getStickyNoteFillColor,
  getStickyNotePathCommands,
  getStickyNoteRenderPoints,
  getStickyNoteShadow,
  getStickyNoteShadowExtent,
  getStickyNoteVariation,
  type StickyNotePathCommand,
  type StickyNoteVariation,
} from "../stickyNote";

const makeSticky = (
  opts: Partial<{
    seed: number;
    width: number;
    height: number;
    roughness: number;
    roundness: { type: number } | null;
    backgroundColor: string;
  }> = {},
) => {
  const sticky = newStickyNoteElement({
    type: "stickynote",
    x: 0,
    y: 0,
    width: opts.width ?? DEFAULT_STICKY_NOTE_SIZE,
    height: opts.height ?? DEFAULT_STICKY_NOTE_SIZE,
    roughness: opts.roughness ?? 0,
    roundness:
      opts.roundness === undefined
        ? { type: ROUNDNESS.PROPORTIONAL_RADIUS }
        : (opts.roundness as any),
    ...(opts.backgroundColor ? { backgroundColor: opts.backgroundColor } : {}),
  });
  return opts.seed === undefined ? sticky : { ...sticky, seed: opts.seed };
};

/** every end and control point of a path, for extent checks */
const pathPoints = (commands: StickyNotePathCommand[]) =>
  commands.flatMap((command) =>
    command.type === "quadratic"
      ? [command.control, command.point]
      : [command.point],
  );

const findSeed = (predicate: (variation: StickyNoteVariation) => boolean) => {
  for (let seed = 1; seed < 10_000; seed++) {
    if (predicate(getStickyNoteVariation(seed))) {
      return seed;
    }
  }
  throw new Error("no seed matches");
};

const SEEDS = Array.from({ length: 500 }, (_, index) => index * 7919 + 13);

describe("sticky note corner radius", () => {
  it("is tight: 0.8% of the shorter side", () => {
    expect(getStickyNoteCornerRadius(makeSticky())).toBeCloseTo(
      DEFAULT_STICKY_NOTE_SIZE * 0.008,
    );
    expect(
      getStickyNoteCornerRadius(makeSticky({ width: 100, height: 300 })),
    ).toBeCloseTo(0.8);
  });

  it("caps at 3 px on large notes", () => {
    expect(
      getStickyNoteCornerRadius(makeSticky({ width: 2000, height: 2000 })),
    ).toBe(3);
  });

  it("is 0 for sharp notes", () => {
    expect(getStickyNoteCornerRadius(makeSticky({ roundness: null }))).toBe(0);
  });
});

describe("getStickyNoteVariation", () => {
  it("rejects a non-finite seed", () => {
    expect(() => getStickyNoteVariation(Number.NaN)).toThrow();
    expect(() => getStickyNoteVariation(Number.POSITIVE_INFINITY)).toThrow();
  });

  it("is deterministic per seed", () => {
    expect(getStickyNoteVariation(1234)).toEqual(getStickyNoteVariation(1234));
  });

  it("differs between seeds", () => {
    expect(getStickyNoteVariation(1)).not.toEqual(getStickyNoteVariation(2));
  });

  it("stays within its limits", () => {
    const limits = STICKY_NOTE_VARIATION_LIMITS;
    for (const seed of SEEDS) {
      const variation = getStickyNoteVariation(seed);
      expect(Math.abs(variation.hueShift)).toBeLessThanOrEqual(limits.hueShift);
      expect(Math.abs(variation.lightnessShift)).toBeLessThanOrEqual(
        limits.lightnessShift,
      );
      expect(variation.curlDepth).toBeGreaterThanOrEqual(limits.curlDepth[0]);
      expect(variation.curlDepth).toBeLessThanOrEqual(limits.curlDepth[1]);
      expect(Math.abs(variation.shadowOffsetX)).toBeLessThanOrEqual(
        limits.shadowOffsetX,
      );
      expect(variation.shadowOffsetY).toBeGreaterThanOrEqual(
        limits.shadowOffsetY[0],
      );
      expect(variation.shadowOffsetY).toBeLessThanOrEqual(
        limits.shadowOffsetY[1],
      );
      expect(variation.edgeWaviness).toBeGreaterThanOrEqual(0);
      expect(variation.edgeWaviness).toBeLessThanOrEqual(1);
    }
  });

  it("curls the left, the right or both bottom corners across seeds", () => {
    const sides = new Set(
      SEEDS.map((seed) => getStickyNoteVariation(seed).curl),
    );
    expect(sides).toEqual(new Set(["left", "right", "both"]));
  });
});

describe("getStickyNoteCreationAngle", () => {
  const toSigned = (angle: number) =>
    angle > Math.PI ? angle - 2 * Math.PI : angle;

  it("rejects a non-finite seed", () => {
    expect(() => getStickyNoteCreationAngle(Number.NaN)).toThrow();
  });

  it("tilts within ±1.5°, normalised to [0, 2π)", () => {
    expect(STICKY_NOTE_MAX_TILT).toBeCloseTo((1.5 * Math.PI) / 180);
    for (const seed of SEEDS) {
      const angle = getStickyNoteCreationAngle(seed);
      expect(angle).toBeGreaterThanOrEqual(0);
      expect(angle).toBeLessThan(2 * Math.PI);
      expect(Math.abs(toSigned(angle))).toBeLessThanOrEqual(
        STICKY_NOTE_MAX_TILT,
      );
    }
  });

  it("is deterministic per seed and tilts both ways", () => {
    expect(getStickyNoteCreationAngle(42)).toBe(getStickyNoteCreationAngle(42));
    const signs = new Set(
      SEEDS.map((seed) =>
        Math.sign(toSigned(getStickyNoteCreationAngle(seed))),
      ),
    );
    expect(signs.has(1)).toBe(true);
    expect(signs.has(-1)).toBe(true);
  });
});

describe("sticky note tone", () => {
  it("shifts hue and lightness by the given amounts", () => {
    const shifted = shiftColorTone("#ffdf6b", { hue: 3, lightness: 0.04 });
    const before = tinycolor("#ffdf6b").toHsl();
    const after = tinycolor(shifted).toHsl();
    expect(after.h - before.h).toBeCloseTo(3, 0);
    expect(after.l - before.l).toBeCloseTo(0.04, 2);
  });

  it("keeps the alpha channel", () => {
    const shifted = shiftColorTone("#ffdf6b80", { hue: -2, lightness: -0.02 });
    expect(tinycolor(shifted).getAlpha()).toBeCloseTo(0.5, 2);
  });

  it("rejects non-finite shifts", () => {
    expect(() =>
      shiftColorTone("#ffdf6b", { hue: Number.NaN, lightness: 0 }),
    ).toThrow();
  });

  it("is render-only: the stored background colour is untouched", () => {
    const sticky = makeSticky({ seed: 99, backgroundColor: "#ffdf6b" });
    const fill = getStickyNoteFillColor(sticky);
    expect(sticky.backgroundColor).toBe("#ffdf6b");
    const variation = getStickyNoteVariation(99);
    expect(fill).toBe(
      shiftColorTone("#ffdf6b", {
        hue: variation.hueShift,
        lightness: variation.lightnessShift,
      }),
    );
  });

  it("varies between notes of the same colour", () => {
    const fills = new Set(
      SEEDS.slice(0, 20).map((seed) =>
        getStickyNoteFillColor(
          makeSticky({ seed, backgroundColor: "#ffdf6b" }),
        ),
      ),
    );
    expect(fills.size).toBeGreaterThan(10);
  });
});

describe("sticky note curl", () => {
  const size = DEFAULT_STICKY_NOTE_SIZE;
  /** distance from the corner to the nearest end or control point */
  const gapAt = (
    points: { x: number; y: number }[],
    corner: { x: number; y: number },
  ) =>
    Math.min(
      ...points.map((point) =>
        Math.hypot(point.x - corner.x, point.y - corner.y),
      ),
    );

  it("lifts only the bottom-right corner when the seed curls right", () => {
    const seed = findSeed((variation) => variation.curl === "right");
    const points = pathPoints(getStickyNotePathCommands(makeSticky({ seed })));

    // lifted: the outline stays clear of the corner itself
    expect(gapAt(points, { x: size, y: size })).toBeGreaterThan(0.5);
    // flat: the rounded corner's control point is the corner
    expect(gapAt(points, { x: 0, y: size })).toBeCloseTo(0);
  });

  it("lifts both bottom corners when the seed curls both", () => {
    const seed = findSeed((variation) => variation.curl === "both");
    const points = pathPoints(getStickyNotePathCommands(makeSticky({ seed })));

    expect(gapAt(points, { x: size, y: size })).toBeGreaterThan(0.5);
    expect(gapAt(points, { x: 0, y: size })).toBeGreaterThan(0.5);
  });

  it("lifts further on a sloppier note", () => {
    const seed = findSeed((variation) => variation.curl === "right");
    // measured from the jittered corner, so only the lift counts
    const gap = (roughness: number) => {
      const sticky = makeSticky({ seed, roughness });
      return gapAt(
        pathPoints(getStickyNotePathCommands(sticky)),
        getStickyNoteRenderPoints(sticky)[2],
      );
    };
    expect(gap(1)).toBeGreaterThan(gap(0));
  });

  it("never lifts the top corners", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const points = pathPoints(
        getStickyNotePathCommands(makeSticky({ seed })),
      );
      expect(Math.min(...points.map((point) => point.y))).toBeCloseTo(0);
    }
  });

  it("is identical for the same seed", () => {
    const sticky = makeSticky({ seed: 7, roughness: 2 });
    expect(getStickyNotePathCommands(sticky)).toEqual(
      getStickyNotePathCommands({ ...sticky }),
    );
  });
});

describe("sticky note shadow", () => {
  it("is blurred and deeper under the bottom edge than above the top", () => {
    const sticky = makeSticky({ seed: 11 });
    const shadow = getStickyNoteShadow(sticky);
    const points = pathPoints(shadow.commands);
    const ys = points.map((point) => point.y);

    expect(shadow.blur).toBeGreaterThan(0);
    expect(shadow.opacity).toBeGreaterThan(0);
    expect(shadow.opacity).toBeLessThan(1);
    // the shadow's top edge sits below the paper's, its bottom edge further
    // below the paper's bottom
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys) - sticky.height).toBeGreaterThan(Math.min(...ys));
  });

  it("drops further under a curled corner", () => {
    const seed = findSeed((variation) => variation.curl === "right");
    const sticky = makeSticky({ seed });
    const points = pathPoints(getStickyNoteShadow(sticky).commands);
    const variation = getStickyNoteVariation(seed);
    const right = points.filter((point) => point.x > sticky.width / 2);
    const left = points.filter((point) => point.x <= sticky.width / 2);

    expect(Math.max(...right.map((point) => point.y))).toBeGreaterThan(
      Math.max(...left.map((point) => point.y)),
    );
    expect(variation.curl).toBe("right");
  });

  it("is covered by its reported extent", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const sticky = makeSticky({ seed, roughness: 2 });
      const shadow = getStickyNoteShadow(sticky);
      const extent = getStickyNoteShadowExtent(sticky);
      for (const point of pathPoints(shadow.commands)) {
        expect(point.x + shadow.blur * 1.5).toBeLessThanOrEqual(
          sticky.width + extent,
        );
        expect(point.x - shadow.blur * 1.5).toBeGreaterThanOrEqual(-extent);
        expect(point.y + shadow.blur * 1.5).toBeLessThanOrEqual(
          sticky.height + extent,
        );
      }
    }
  });

  it("fits inside the cached element canvas padding up to 4× device scale", () => {
    for (const size of [80, 250, 1200]) {
      const sticky = makeSticky({ width: size, height: size, roughness: 2 });
      expect(getCanvasPadding(sticky)).toBeGreaterThanOrEqual(
        getStickyNoteShadowExtent(sticky) * 4,
      );
    }
  });
});
