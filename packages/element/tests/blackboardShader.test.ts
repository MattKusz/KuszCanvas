import {
  BOARD_DETAIL_LAYERS,
  BOARD_FRAGMENT_SHADER,
  BOARD_HAZE_DOWNSCALE,
  BOARD_HAZE_FRAGMENT_SHADER,
  BOARD_HAZE_LAYERS,
  BOARD_LAYERS,
  BOARD_NOISE_SIZE,
  BOARD_SHADER_BASE,
  BOARD_SMEAR_ANGLE_SPREAD,
  BOARD_SMEAR_FELT,
  BOARD_SMEAR_REACH,
  BOARD_SMEAR_SHAPE,
  BOARD_SMEAR_STROKES,
  BOARD_VERTEX_SHADER,
  generateBoardNoise,
  getBoardBandWeight,
  getBoardHazeSize,
  getBoardLayerUniforms,
  getBoardRegionFrame,
  planBoardChunks,
} from "../src/blackboardShader";

import { BLACKBOARD_BASE_COLOR } from "../src/blackboard";

import type { BoardFrame, BoardLayer } from "../src/blackboardShader";

const layer = (id: string): BoardLayer => {
  const found = BOARD_LAYERS.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`no layer ${id}`);
  }
  return found;
};

/**
 * The lattice coordinate (cell + fraction) the shader computes for device
 * pixel `p` of a region, in float64 and wrapped back to an unbounded integer.
 */
const latticeAt = (
  target: BoardLayer,
  frame: BoardFrame,
  slotOctave: number,
  p: Readonly<{ x: number; y: number }>,
) => {
  const uniforms = getBoardLayerUniforms(target, frame);
  for (let slot = 0; slot < target.slots; slot++) {
    if (uniforms.cell[slot * 4 + 3] !== slotOctave) {
      continue;
    }
    const L = uniforms.lattice.subarray(slot * 4, slot * 4 + 4);
    const M = uniforms.matrix.subarray(slot * 4, slot * 4 + 4);
    const C = uniforms.cell.subarray(slot * 4, slot * 4 + 4);
    return {
      x: C[0] + L[0] + M[0] * p.x + M[1] * p.y,
      y: C[1] + L[1] + M[2] * p.x + M[3] * p.y,
      seed: C[2],
    };
  }
  return null;
};

describe("getBoardBandWeight", () => {
  const mottle = layer("mottle");
  const [lo, hi] = mottle.band;

  it("is full inside the band and zero an octave outside it", () => {
    expect(getBoardBandWeight(mottle, lo)).toBeCloseTo(1, 9);
    expect(getBoardBandWeight(mottle, Math.sqrt(lo * hi))).toBeCloseTo(1, 9);
    expect(getBoardBandWeight(mottle, hi)).toBeCloseTo(1, 9);
    expect(getBoardBandWeight(mottle, lo / 2)).toBe(0);
    expect(getBoardBandWeight(mottle, hi * 2)).toBe(0);
    expect(getBoardBandWeight(mottle, lo / 4)).toBe(0);
    const fading = getBoardBandWeight(mottle, lo * 0.7);
    expect(fading).toBeGreaterThan(0);
    expect(fading).toBeLessThan(1);
  });

  it("validates its inputs", () => {
    expect(() => getBoardBandWeight(mottle, 0)).toThrow(/cell size/);
    expect(() => getBoardBandWeight(mottle, Number.NaN)).toThrow(/cell size/);
    expect(() => getBoardBandWeight(null as any, 10)).toThrow(/layer/);
  });
});

describe("getBoardLayerUniforms", () => {
  const frame = (overrides: Partial<BoardFrame> = {}): BoardFrame => ({
    sceneX: 0,
    sceneY: 0,
    zoom: 1,
    pixelRatio: 1,
    ...overrides,
  });

  it("packs four values per slot for every layer", () => {
    for (const entry of BOARD_LAYERS) {
      const uniforms = getBoardLayerUniforms(entry, frame());
      expect(uniforms.lattice).toHaveLength(entry.slots * 4);
      expect(uniforms.matrix).toHaveLength(entry.slots * 4);
      expect(uniforms.cell).toHaveLength(entry.slots * 4);
    }
  });

  it("has enough slots for every octave the band can show", () => {
    for (const entry of BOARD_LAYERS.filter((e) => e.scaling === "zoom")) {
      for (const zoom of [0.1, 0.13, 0.5, 1, 1.37, 3, 30]) {
        const uniforms = getBoardLayerUniforms(entry, frame({ zoom }));
        let total = 0;
        for (let slot = 0; slot < entry.slots; slot++) {
          total += uniforms.lattice[slot * 4 + 2] > 0 ? 1 : 0;
        }
        expect(total).toBeGreaterThan(0);
        // every octave whose weight is non-zero got a slot
        const lowest = Math.ceil(Math.log2(entry.band[0] / 2 / zoom));
        const highest = Math.floor(Math.log2((entry.band[1] * 2) / zoom));
        for (let k = lowest; k <= highest; k++) {
          const weight = getBoardBandWeight(entry, 2 ** k * zoom);
          if (weight > 0) {
            expect(
              latticeAt(entry, frame({ zoom }), k, { x: 0, y: 0 }),
            ).not.toBeNull();
          }
        }
      }
    }
  });

  it("anchors every octave in scene space, far from the origin too", () => {
    const mottle = layer("mottle");
    for (const [sceneX, sceneY] of [
      [0, 0],
      [-123456.789, 98765.4321],
      [4.5e6, -3.25e6],
    ]) {
      const zoom = 0.73;
      const pixelRatio = 1.5;
      const a = frame({ sceneX, sceneY, zoom, pixelRatio });
      // a region starting 300 × 200 device px further on
      const b = frame({
        sceneX: sceneX + 300 / (zoom * pixelRatio),
        sceneY: sceneY + 200 / (zoom * pixelRatio),
        zoom,
        pixelRatio,
      });
      const k = Math.round(Math.log2(100 / zoom));
      const fromA = latticeAt(mottle, a, k, { x: 340, y: 250 });
      const fromB = latticeAt(mottle, b, k, { x: 40, y: 50 });
      expect(fromA).not.toBeNull();
      expect(fromB!.x).toBeCloseTo(fromA!.x, 4);
      expect(fromB!.y).toBeCloseTo(fromA!.y, 4);
      expect(fromB!.seed).toBe(fromA!.seed);
    }
  });

  it("keeps the in-shader fraction small and the matrix scaled to the view", () => {
    const mottle = layer("mottle");
    const far = getBoardLayerUniforms(
      mottle,
      frame({ sceneX: 7.7e7, sceneY: -9.1e7, zoom: 2, pixelRatio: 2 }),
    );
    for (let slot = 0; slot < mottle.slots; slot++) {
      expect(far.lattice[slot * 4]).toBeGreaterThanOrEqual(0);
      expect(far.lattice[slot * 4]).toBeLessThan(1);
      expect(far.lattice[slot * 4 + 1]).toBeGreaterThanOrEqual(0);
      expect(far.lattice[slot * 4 + 1]).toBeLessThan(1);
      const k = far.cell[slot * 4 + 3];
      if (far.lattice[slot * 4 + 2] === 0) {
        continue;
      }
      // device px per lattice cell
      expect(far.lattice[slot * 4 + 3]).toBeCloseTo(2 ** k * 2 * 2, 3);
      const m = far.matrix.subarray(slot * 4, slot * 4 + 4);
      const det = Math.abs(m[0] * m[3] - m[1] * m[2]);
      expect(det).toBeCloseTo((1 / (2 ** k * 2 * 2)) ** 2 / mottle.aspect, 9);
    }
  });

  it("seeds an octave by its layer and scale, not its slot", () => {
    const mottle = layer("mottle");
    const k = 6;
    const at1 = latticeAt(mottle, frame({ zoom: 1 }), k, { x: 0, y: 0 });
    const at2 = latticeAt(mottle, frame({ zoom: 2 }), k, { x: 0, y: 0 });
    expect(at1!.seed).toBe(at2!.seed);
    const other = latticeAt(mottle, frame({ zoom: 1 }), k + 1, { x: 0, y: 0 });
    expect(other!.seed).not.toBe(at1!.seed);
    const smear = layer("smear");
    const smearK = Math.round(Math.log2(smear.band[0]));
    const mottleSame = latticeAt(mottle, frame(), smearK, { x: 0, y: 0 });
    const smearSame = latticeAt(smear, frame(), smearK, { x: 0, y: 0 });
    if (mottleSame && smearSame) {
      expect(mottleSame.seed).not.toBe(smearSame.seed);
    }
  });

  it("fixes the smudges' octaves in scene units, so they scale with zoom", () => {
    for (const id of ["smear", "mottle"]) {
      const entry = layer(id);
      expect(entry.scaling).toBe("scene");
      const octaves = (zoom: number) => {
        const uniforms = getBoardLayerUniforms(entry, frame({ zoom }));
        const out: Array<[number, number, number]> = [];
        for (let slot = 0; slot < entry.slots; slot++) {
          out.push([
            uniforms.cell[slot * 4 + 3],
            uniforms.lattice[slot * 4 + 2],
            uniforms.lattice[slot * 4 + 3] / zoom,
          ]);
        }
        return out;
      };
      // the same cells, weights and scene size at every ordinary zoom
      const at1 = octaves(1);
      for (const zoom of [0.5, 1.37, 3, 30]) {
        octaves(zoom).forEach(([k, weight, cellScene], slot) => {
          expect(k).toBe(at1[slot][0]);
          expect(weight).toBeCloseTo(at1[slot][1], 9);
          expect(cellScene).toBeCloseTo(at1[slot][2], 3);
        });
      }
      expect(at1[0][2]).toBeCloseTo(entry.band[0], 3);
    }
  });

  it("sizes eraser strokes like a whiteboard's at 100%", () => {
    const smear = layer("smear");
    expect(smear.band[0]).toBeGreaterThanOrEqual(256);
    expect(smear.band[1]).toBeLessThanOrEqual(1024);
  });

  it("fades scene-scaled octaves only once they shrink below a few px", () => {
    const mottle = layer("mottle");
    const weights = (zoom: number) =>
      getBoardLayerUniforms(mottle, frame({ zoom })).lattice.filter(
        (_, index) => index % 4 === 2,
      );
    // mottle's finest cells: 64 scene units, 1.28 CSS px at zoom 0.02
    expect(weights(0.02)[0]).toBe(0);
    expect(weights(0.1)[0]).toBeGreaterThan(0);
  });

  it("keeps a layer's summed weight steady while zooming", () => {
    for (const entry of BOARD_LAYERS) {
      const sums: number[] = [];
      // zoom through two octaves well inside the editor's zoom range
      for (let step = 0; step <= 64; step++) {
        const zoom = 0.5 * 2 ** (step / 32);
        const uniforms = getBoardLayerUniforms(entry, frame({ zoom }));
        let sum = 0;
        for (let slot = 0; slot < entry.slots; slot++) {
          sum += uniforms.lattice[slot * 4 + 2] ** 2;
        }
        sums.push(Math.sqrt(sum));
      }
      const max = Math.max(...sums);
      const min = Math.min(...sums);
      expect(min / max).toBeGreaterThan(0.85);
    }
  });

  it("validates the frame", () => {
    const mottle = layer("mottle");
    expect(() => getBoardLayerUniforms(mottle, frame({ zoom: 0 }))).toThrow(
      /zoom/,
    );
    expect(() =>
      getBoardLayerUniforms(mottle, frame({ pixelRatio: -1 })),
    ).toThrow(/pixelRatio/);
    expect(() =>
      getBoardLayerUniforms(mottle, frame({ sceneX: Number.NaN })),
    ).toThrow(/scene/);
    expect(() => getBoardLayerUniforms(null as any, frame())).toThrow(/layer/);
  });
});

describe("getBoardRegionFrame", () => {
  it("maps a region's top-left device px to scene coordinates", () => {
    const view = { scrollX: 100, scrollY: -50, zoom: 2 };
    expect(getBoardRegionFrame(view, 1.5, 0, 0)).toEqual({
      sceneX: -100,
      sceneY: 50,
      zoom: 2,
      pixelRatio: 1.5,
    });
    // 300 device px = 200 CSS px = 100 scene units at zoom 2
    expect(getBoardRegionFrame(view, 1.5, 300, 600)).toEqual({
      sceneX: 0,
      sceneY: 250,
      zoom: 2,
      pixelRatio: 1.5,
    });
  });

  it("validates its inputs", () => {
    expect(() =>
      getBoardRegionFrame({ scrollX: 0, scrollY: 0, zoom: 0 }, 1, 0, 0),
    ).toThrow(/zoom/);
    expect(() =>
      getBoardRegionFrame({ scrollX: 0, scrollY: 0, zoom: 1 }, 0, 0, 0),
    ).toThrow(/pixelRatio/);
    expect(() =>
      getBoardRegionFrame({ scrollX: Infinity, scrollY: 0, zoom: 1 }, 1, 0, 0),
    ).toThrow(/scroll/);
  });
});

describe("planBoardChunks", () => {
  it("covers the area exactly with chunks no larger than the limit", () => {
    const chunks = planBoardChunks(5000, 2100, 2048);
    expect(chunks).toHaveLength(3 * 2);
    let area = 0;
    for (const chunk of chunks) {
      expect(chunk.width).toBeLessThanOrEqual(2048);
      expect(chunk.height).toBeLessThanOrEqual(2048);
      expect(chunk.width).toBeGreaterThan(0);
      expect(chunk.height).toBeGreaterThan(0);
      area += chunk.width * chunk.height;
    }
    expect(area).toBe(5000 * 2100);
    expect(chunks[0]).toEqual({ x: 0, y: 0, width: 2048, height: 2048 });
    expect(chunks[chunks.length - 1]).toEqual({
      x: 4096,
      y: 2048,
      width: 904,
      height: 52,
    });
  });

  it("returns one chunk when the area fits, none when it is empty", () => {
    expect(planBoardChunks(800, 600, 2048)).toEqual([
      { x: 0, y: 0, width: 800, height: 600 },
    ]);
    expect(planBoardChunks(0, 600, 2048)).toEqual([]);
  });

  it("validates its inputs", () => {
    expect(() => planBoardChunks(-1, 10, 2048)).toThrow(/size/);
    expect(() => planBoardChunks(10.5, 10, 2048)).toThrow(/size/);
    expect(() => planBoardChunks(10, 10, 0)).toThrow(/limit/);
  });
});

describe("board shaders", () => {
  it("are GLSL ES 3.00 and draw every layer in exactly one pass", () => {
    expect(BOARD_VERTEX_SHADER.startsWith("#version 300 es")).toBe(true);
    expect(BOARD_FRAGMENT_SHADER.startsWith("#version 300 es")).toBe(true);
    expect(BOARD_HAZE_FRAGMENT_SHADER.startsWith("#version 300 es")).toBe(true);
    const passes = [
      [BOARD_HAZE_LAYERS, BOARD_HAZE_FRAGMENT_SHADER, BOARD_FRAGMENT_SHADER],
      [BOARD_DETAIL_LAYERS, BOARD_FRAGMENT_SHADER, BOARD_HAZE_FRAGMENT_SHADER],
    ] as const;
    for (const [layers, own, other] of passes) {
      for (const entry of layers) {
        for (const kind of ["Lattice", "Matrix"]) {
          const declaration = `uniform vec4 ${entry.uniform}${kind}[${entry.slots}];`;
          expect(own).toContain(declaration);
          expect(other).not.toContain(declaration);
        }
        expect(own).toContain(
          `uniform ivec4 ${entry.uniform}Cell[${entry.slots}];`,
        );
      }
    }
    expect(
      [...BOARD_HAZE_LAYERS, ...BOARD_DETAIL_LAYERS]
        .map((entry) => entry.id)
        .sort(),
    ).toEqual(BOARD_LAYERS.map((entry) => entry.id).sort());
  });

  it("draw everything coarser than the haze texels in the haze pass", () => {
    // a haze texel covers BOARD_HAZE_DOWNSCALE device px, so a layer whose
    // finest cell spans two texels (at dpr 1) is smooth enough to upsample
    for (const entry of BOARD_HAZE_LAYERS) {
      expect(entry.band[0]).toBeGreaterThanOrEqual(2 * BOARD_HAZE_DOWNSCALE);
    }
    expect(BOARD_HAZE_LAYERS.map((entry) => entry.id)).toEqual([
      "mottle",
      "smear",
    ]);
    // the haze texture carries only erased chalk; the mottle steers where
    // it lies thick but adds no tone of its own
    expect(BOARD_HAZE_FRAGMENT_SHADER).toMatch(/outColor = vec4\(\s*residue/);
    expect(BOARD_HAZE_FRAGMENT_SHADER).not.toMatch(
      /outColor = vec4\([^;]*mottle/,
    );
  });

  it("keep the board a solid slate between the eraser strokes", () => {
    // no cloudy tone and no grit: nothing but erased chalk and the odd
    // scratch lightens the flat base
    expect(BOARD_LAYERS.map((entry) => entry.id)).toEqual([
      "mottle",
      "smear",
      "scratch",
    ]);
    expect(BOARD_FRAGMENT_SHADER).not.toMatch(/mottle|grain|fibre|dust/);
    expect(BOARD_HAZE_FRAGMENT_SHADER).not.toMatch(/dust/);
  });

  it("leave erased chalk faint, not white", () => {
    expect(layer("smear").gain).toBeLessThanOrEqual(0.009);
  });

  it("place strokes anywhere in their cell, so no grid seams show", () => {
    // centres kept to the middle of each cell leave a faint line along every
    // cell row, which shows as rows of strokes when zoomed out
    expect(BOARD_HAZE_FRAGMENT_SHADER).toContain("vec2 d = q - home - r0.yz;");
  });

  it("round off the ends of each eraser stroke", () => {
    // a cut straight across the stroke shows as a hard upright edge; the
    // fade starts earlier towards the stroke's sides
    expect(BOARD_HAZE_FRAGMENT_SHADER).toMatch(
      /smoothstep\([^;]*abs\(u\) \+ [\d.]+ \* v \* v/,
    );
  });

  it("cover the board in eraser strokes, each still visible", () => {
    // strokes per smear cell, counting the coarser octaves' share: the
    // first board had 0.55
    const smear = layer("smear");
    let share = 0;
    for (let slot = 0; slot < smear.octaves; slot++) {
      share += 4 ** -slot;
    }
    const strokes =
      BOARD_SMEAR_STROKES.perCell * BOARD_SMEAR_STROKES.density * share;
    // at least one stroke per 256 px square of board at 100 %, but fewer
    // than the 1.8 that crowded the board
    const per256 = (strokes * 256 ** 2) / smear.band[0] ** 2;
    expect(per256).toBeGreaterThanOrEqual(1);
    expect(per256).toBeLessThanOrEqual(1.3);
    // how many strokes cover a point on average: past about three the
    // bands merge into cloud and no single stroke shows
    const mean = (pair: readonly [number, number]) => (pair[0] + pair[1]) / 2;
    const depth =
      strokes *
      (2 * mean(BOARD_SMEAR_SHAPE.halfLength)) *
      (2 * mean(BOARD_SMEAR_SHAPE.halfWidth));
    expect(depth).toBeLessThanOrEqual(3);
    expect(BOARD_HAZE_FRAGMENT_SHADER).toContain(
      `for (int k = 0; k < ${BOARD_SMEAR_STROKES.perCell};`,
    );
  });

  it("erase in mostly left-right arcs", () => {
    // stroke angles stay within the spread of horizontal
    expect(BOARD_SMEAR_ANGLE_SPREAD).toBeGreaterThan(0);
    expect(BOARD_SMEAR_ANGLE_SPREAD).toBeLessThanOrEqual(Math.PI / 6);
    // and no octave rotates its lattice away from horizontal
    expect(layer("smear").tilt).toBe(0);
    const smear = BOARD_HAZE_FRAGMENT_SHADER.slice(
      BOARD_HAZE_FRAGMENT_SHADER.indexOf("float smearLayer"),
    );
    expect(smear).not.toMatch(/angle = r0\.w \* 6\.28/);
  });

  it("wipe with a fat block eraser, not a small one", () => {
    const { halfLength, halfWidth } = BOARD_SMEAR_SHAPE;
    const [lo] = layer("smear").band;
    // in px at 100 %: half 140-256 long, as before, and 100-150 wide
    expect(halfLength[0] * lo).toBeCloseTo(140, -1);
    expect(halfLength[1] * lo).toBeCloseTo(256, -1);
    expect(halfWidth[0] * lo).toBeGreaterThanOrEqual(100);
    expect(halfWidth[1] * lo).toBeGreaterThanOrEqual(150);
    expect(BOARD_HAZE_FRAGMENT_SHADER).toContain(
      `float halfWidth = mix(${halfWidth[0]}`,
    );
  });

  it("draw each stroke as one solid band, not separate lines", () => {
    // the felt texture only shades the band: it never splits it apart
    expect(BOARD_SMEAR_FELT.fill).toBeGreaterThanOrEqual(0.7);
    expect(BOARD_SMEAR_FELT.fill - BOARD_SMEAR_FELT.texture).toBeGreaterThan(
      0.4,
    );
  });

  it("draw no chalk specks", () => {
    expect(BOARD_LAYERS.map((entry) => entry.id)).not.toContain("speck");
    expect(BOARD_FRAGMENT_SHADER).not.toMatch(/speck/i);
  });

  it("look only at the cells whose strokes can reach a pixel", () => {
    // furthest a stroke reaches from its centre, in cells: along it, and
    // across it with the widest band and the deepest arc, turned by the
    // widest angle
    const { halfLength, halfWidth } = BOARD_SMEAR_SHAPE;
    const along = halfLength[1];
    const across = halfWidth[1] * 1.02 + 0.5 * 0.9 * halfLength[1] ** 2;
    const turn = BOARD_SMEAR_ANGLE_SPREAD;
    expect(BOARD_SMEAR_REACH.x).toBeCloseTo(
      along * Math.cos(turn) + across * Math.sin(turn),
      9,
    );
    expect(BOARD_SMEAR_REACH.y).toBeCloseTo(
      along * Math.sin(turn) + across * Math.cos(turn),
      9,
    );
    // at most four cells a side, three or four by where the pixel sits,
    // instead of a fixed five
    expect(BOARD_SMEAR_REACH.x).toBeLessThan(1.5);
    expect(BOARD_SMEAR_REACH.y).toBeLessThan(1.5);
    expect(BOARD_HAZE_FRAGMENT_SHADER).toContain(
      "ivec2 first = ivec2(floor(q - reach));",
    );
    expect(BOARD_HAZE_FRAGMENT_SHADER).toContain(
      "for (int cy = first.y; cy <= last.y; cy++)",
    );
  });

  it("sit on dark slate grey with a barely green tinge", () => {
    const [r, g, b] = BOARD_SHADER_BASE;
    expect(Math.min(r, g, b)).toBeGreaterThanOrEqual(8);
    expect(Math.max(r, g, b)).toBeLessThanOrEqual(16);
    expect(g - r).toBeGreaterThan(0);
    expect(g - r).toBeLessThanOrEqual(3);
    expect(g - b).toBeGreaterThan(0);
    expect(g - b).toBeLessThanOrEqual(3);
  });

  it("keep the flat board colour at the shader board's mean", () => {
    // erased chalk only lightens, so the mean sits a few levels above the base
    const flat = [1, 3, 5].map((at) =>
      parseInt(BLACKBOARD_BASE_COLOR.slice(at, at + 2), 16),
    );
    flat.forEach((channel, index) => {
      expect(channel - BOARD_SHADER_BASE[index]).toBeGreaterThanOrEqual(0);
      expect(channel - BOARD_SHADER_BASE[index]).toBeLessThanOrEqual(5);
    });
  });
});

describe("getBoardHazeSize", () => {
  it("covers the region at the downscale plus a texel each side", () => {
    expect(getBoardHazeSize(2560, 1600)).toEqual({
      width: Math.ceil(2560 / BOARD_HAZE_DOWNSCALE) + 2,
      height: Math.ceil(1600 / BOARD_HAZE_DOWNSCALE) + 2,
    });
    expect(getBoardHazeSize(1, 1)).toEqual({ width: 3, height: 3 });
  });

  it("validates its inputs", () => {
    expect(() => getBoardHazeSize(-1, 1)).toThrow(/size/);
    expect(() => getBoardHazeSize(1, Number.NaN)).toThrow(/size/);
  });
});

describe("generateBoardNoise", () => {
  it("is deterministic per seed, four independent bytes per texel", () => {
    const noise = generateBoardNoise(64, 9);
    expect(noise).toHaveLength(64 * 64 * 4);
    expect(noise).toEqual(generateBoardNoise(64, 9));
    expect(noise).not.toEqual(generateBoardNoise(64, 10));
  });

  it("is uniform and uncorrelated between channels and neighbours", () => {
    const size = 256;
    const noise = generateBoardNoise(size, 3);
    const channel = (c: number) => {
      const out = new Float64Array(size * size);
      for (let i = 0; i < out.length; i++) {
        out[i] = noise[i * 4 + c] / 255 - 0.5;
      }
      return out;
    };
    const correlation = (a: Float64Array, b: Float64Array) => {
      let ab = 0;
      let aa = 0;
      let bb = 0;
      for (let i = 0; i < a.length; i++) {
        ab += a[i] * b[i];
        aa += a[i] * a[i];
        bb += b[i] * b[i];
      }
      return ab / Math.sqrt(aa * bb);
    };
    const red = channel(0);
    const mean = red.reduce((sum, value) => sum + value, 0) / red.length;
    expect(Math.abs(mean)).toBeLessThan(0.01);
    expect(Math.abs(correlation(red, channel(1)))).toBeLessThan(0.02);
    expect(Math.abs(correlation(red, channel(3)))).toBeLessThan(0.02);
    const shifted = red.slice(1);
    expect(Math.abs(correlation(red.slice(0, -1), shifted))).toBeLessThan(0.02);
  });

  it("uses a power-of-two size the shader can wrap with a bit mask", () => {
    expect(BOARD_NOISE_SIZE & (BOARD_NOISE_SIZE - 1)).toBe(0);
    expect(BOARD_FRAGMENT_SHADER).toContain(`${BOARD_NOISE_SIZE - 1}u`);
  });

  it("validates its inputs", () => {
    expect(() => generateBoardNoise(100, 1)).toThrow(/size/);
    expect(() => generateBoardNoise(64, Number.NaN)).toThrow(/seed/);
  });
});
