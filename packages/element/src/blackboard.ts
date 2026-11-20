/**
 * KuszCanvas: blackboard (chalk) rendering for dark theme — pure decisions
 * and data. The canvas side lives in `renderChalk.ts`, the SVG side in
 * `packages/excalidraw/renderer/chalkSvg.ts`.
 *
 * Chalk is a texture, not a colour change: each chalked element is painted
 * into its own layer, a seeded noise tile erases grain out of it
 * (`destination-out`) and the layer is composited as usual. Fills take a
 * lighter grain than outlines and text; Markdown code runs stay solid.
 */
import { FONT_FAMILY, ROUGHNESS, THEME } from "@excalidraw/common";

import { isStylableFrame } from "./frameStyle";

import type { MarkdownPaintOp } from "./markdownTextRender";
import type { ExcalidrawElement } from "./types";
import type { Drawable } from "roughjs/bin/core";

/**
 * Paint layers of a chalked element. `fill` and `stroke` get grain of
 * different strength; `solid` is painted without grain (code runs).
 */
export type ChalkLayer = "fill" | "stroke" | "solid";

export const CHALK_LAYERS: readonly ChalkLayer[] = ["fill", "stroke", "solid"];

/** Fraction of the noise tile's erase alpha applied per grained layer. */
export const CHALK_LAYER_STRENGTH: Readonly<
  Record<Exclude<ChalkLayer, "solid">, number>
> = Object.freeze({ stroke: 0.9, fill: 0.45 });

/** Opacity of the offset second pass that roughens chalk outlines. */
export const CHALK_JITTER_ALPHA = 0.35;

/** Noise tile edge in pixels (power of two). */
export const CHALK_TILE_SIZE = 128;

/**
 * Scene units one tile covers. Grain lives in scene space, so it scales with
 * zoom and stays put on the element as it moves.
 */
export const CHALK_TILE_SCENE_SIZE = 48;

/** Seed of the shared per-document tile; elements vary by tile offset. */
export const CHALK_TILE_SEED = 0x6368616c; // "chal"

/**
 * The tile is erased twice, the second time rotated and at an
 * incommensurate scale, so large fills show no visible repeat. `strength`
 * multiplies the layer strength per pass.
 */
export const CHALK_GRAIN_PASSES: readonly Readonly<{
  scale: number;
  rotation: number;
  strength: number;
}>[] = Object.freeze([
  { scale: 1, rotation: 0, strength: 0.65 },
  { scale: 0.73, rotation: 0.61, strength: 0.65 },
]);

export const isBlackboardRender = (
  theme: string,
  enabled: boolean,
): boolean => {
  if (theme !== THEME.DARK && theme !== THEME.LIGHT) {
    throw new Error(`isBlackboardRender(): unknown theme "${theme}"`);
  }
  return theme === THEME.DARK && enabled === true;
};

const isSketchy = (element: ExcalidrawElement) =>
  element.roughness >= ROUGHNESS.artist;

/**
 * Whether `element` is drawn as chalk in blackboard mode.
 *
 * - freedraw: always;
 * - rectangle, diamond, ellipse, line, arrow and regular frames: when
 *   sketchy (roughness ≥ artist) — architect stays solid ink;
 * - text: Excalifont only, except on sticky notes (chalk on paper);
 * - sticky notes, images, embeds, magic and marker frames: never.
 *
 * @param container the bound-text container of `element`, if any
 */
export const isChalkElement = (
  element: ExcalidrawElement,
  container: ExcalidrawElement | null,
): boolean => {
  if (!element || typeof element !== "object") {
    throw new Error("isChalkElement(): element is required");
  }
  switch (element.type) {
    case "freedraw":
      return true;
    case "rectangle":
    case "diamond":
    case "ellipse":
    case "line":
    case "arrow":
      return isSketchy(element);
    case "frame":
      return isStylableFrame(element) && isSketchy(element);
    case "text":
      return (
        element.fontFamily === FONT_FAMILY.Excalifont &&
        container?.type !== "stickynote"
      );
    default:
      return false;
  }
};

/**
 * Whether `element` keeps its light-theme colours in blackboard mode: a
 * sticky note is paper on the board, and so is the label written on it.
 *
 * @param container the bound-text container of `element`, if any
 */
export const isPaperRender = (
  element: ExcalidrawElement,
  container: ExcalidrawElement | null,
  theme: string,
  blackboardEnabled: boolean,
): boolean => {
  if (!element || typeof element !== "object") {
    throw new Error("isPaperRender(): element is required");
  }
  if (!isBlackboardRender(theme, blackboardEnabled)) {
    return false;
  }
  return (
    element.type === "stickynote" ||
    (element.type === "text" && container?.type === "stickynote")
  );
};

/**
 * Whether the text editor paints its live preview canvas (and hides the
 * textarea's glyphs): always for a Markdown layout; for plain chalk text
 * only while the element's wrap matches the editor's value, since a stale
 * wrap would misplace the glyphs under the caret.
 */
export const shouldPaintLiveTextPreview = (
  options: Readonly<{
    markdownLayout: object | null;
    chalk: boolean;
    wrapMatches: boolean;
  }>,
): boolean => {
  if (!options || typeof options !== "object") {
    throw new Error("shouldPaintLiveTextPreview(): options are required");
  }
  if (typeof options.chalk !== "boolean") {
    throw new Error("shouldPaintLiveTextPreview(): chalk must be a boolean");
  }
  if (typeof options.wrapMatches !== "boolean") {
    throw new Error(
      "shouldPaintLiveTextPreview(): wrapMatches must be a boolean",
    );
  }
  if (options.markdownLayout !== null) {
    return true;
  }
  return options.chalk && options.wrapMatches;
};

/**
 * The part of a rough drawable that belongs to `layer`: outlines (`path`
 * sets) to `stroke`, hachure and solid fills to `fill`. Null when the layer
 * has nothing to draw.
 */
export const splitDrawableForChalk = (
  drawable: Drawable,
  layer: ChalkLayer,
): Drawable | null => {
  if (!drawable || !Array.isArray(drawable.sets)) {
    throw new Error("splitDrawableForChalk(): drawable is required");
  }
  if (!CHALK_LAYERS.includes(layer)) {
    throw new Error(`splitDrawableForChalk(): invalid layer "${layer}"`);
  }
  if (layer === "solid") {
    return null;
  }
  const sets = drawable.sets.filter((set) =>
    layer === "stroke" ? set.type === "path" : set.type !== "path",
  );
  return sets.length ? { ...drawable, sets } : null;
};

const MARKDOWN_RECT_LAYERS: Readonly<Record<string, ChalkLayer>> = {
  highlight: "fill",
  tableHeader: "fill",
  code: "solid",
  decoration: "stroke",
  quote: "stroke",
  tableGrid: "stroke",
};

/** The chalk layer a Markdown paint op belongs to. */
export const getMarkdownOpChalkLayer = (op: MarkdownPaintOp): ChalkLayer => {
  if (!op || typeof op !== "object") {
    throw new Error("getMarkdownOpChalkLayer(): op is required");
  }
  if (op.kind === "text") {
    return op.style.code ? "solid" : "stroke";
  }
  if (op.kind === "circle") {
    return "stroke";
  }
  const layer = MARKDOWN_RECT_LAYERS[op.role];
  if (!layer) {
    throw new Error(
      `getMarkdownOpChalkLayer(): unknown rect role "${op.role}"`,
    );
  }
  return layer;
};

// ---------------------------------------------------------------------------
// noise

const mulberry32 = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * Wrapping value noise with `cellsX` × `cellsY` random lattice values per
 * tile; fewer cells across x than down y stretches features along x.
 */
const valueNoise = (
  size: number,
  cellsX: number,
  cellsY: number,
  random: () => number,
): Float32Array => {
  const lattice = new Float32Array(cellsX * cellsY);
  for (let i = 0; i < lattice.length; i++) {
    lattice[i] = random();
  }
  const cellWidth = size / cellsX;
  const cellHeight = size / cellsY;
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const gy = y / cellHeight;
    const y0 = Math.floor(gy);
    const ty = smoothstep(0, 1, gy - y0);
    const row0 = (y0 % cellsY) * cellsX;
    const row1 = ((y0 + 1) % cellsY) * cellsX;
    for (let x = 0; x < size; x++) {
      const gx = x / cellWidth;
      const x0 = Math.floor(gx);
      const tx = smoothstep(0, 1, gx - x0);
      const c0 = x0 % cellsX;
      const c1 = (x0 + 1) % cellsX;
      const top = lattice[row0 + c0] * (1 - tx) + lattice[row0 + c1] * tx;
      const bottom = lattice[row1 + c0] * (1 - tx) + lattice[row1 + c1] * tx;
      out[y * size + x] = top * (1 - ty) + bottom * ty;
    }
  }
  return out;
};

/** Wrapping value noise: `cells` random lattice values per tile edge. */
const valueNoiseOctave = (
  size: number,
  cells: number,
  random: () => number,
): Float32Array => valueNoise(size, cells, cells, random);

/** Erase-alpha thresholds on the blended noise (0..1). */
const NOISE_ERASE_FROM = 0.5;
const NOISE_ERASE_FULL = 0.64;

/**
 * A seamless square tile of erase alpha (0 keeps the pixel, 255 erases it):
 * coarse blotches, finer grain and per-pixel speckle, thresholded so a chalk
 * stroke keeps most of its body with real holes in it.
 */
export const generateChalkNoise = (
  size: number,
  seed: number,
): Uint8ClampedArray => {
  if (!Number.isInteger(size) || size < 16 || (size & (size - 1)) !== 0) {
    throw new Error(
      `generateChalkNoise(): size must be a power of two ≥ 16, got ${size}`,
    );
  }
  if (!Number.isFinite(seed)) {
    throw new Error("generateChalkNoise(): seed must be a finite number");
  }
  const random = mulberry32(seed);
  const coarse = valueNoiseOctave(size, size / 8, random);
  const fine = valueNoiseOctave(size, size / 2, random);
  const out = new Uint8ClampedArray(size * size);
  for (let i = 0; i < out.length; i++) {
    const value = 0.3 * coarse[i] + 0.3 * fine[i] + 0.4 * random();
    out[i] = Math.round(
      255 * smoothstep(NOISE_ERASE_FROM, NOISE_ERASE_FULL, value),
    );
  }
  return out;
};

// ---------------------------------------------------------------------------
// the board

/**
 * The board's mean colour: the shader board (`blackboardShader.ts`) averages
 * to it. In blackboard mode it replaces the (dark-filtered) scene
 * background; only a transparent background still clears.
 */
export const BLACKBOARD_BASE_COLOR = "#0e100f";

/** Board texture tile edge in texels (power of two). */
export const BLACKBOARD_TILE_SIZE = 512;

/** Seed of the shared per-document board tile. */
export const BLACKBOARD_TILE_SEED = 0x626f6172; // "boar"

/**
 * CSS px per texel: the zoom (one texel per scene unit), clamped so the
 * texture neither blows up into blotches nor shrinks into noise.
 */
export const BLACKBOARD_PATTERN_SCALE = Object.freeze({ min: 0.5, max: 2 });

/** Largest lightness change of each texture layer (overlay alpha). */
const BOARD_MOTTLE = 0.04;
const BOARD_SMEAR = 0.03;
const BOARD_SPECK = Object.freeze({ min: 0.02, max: 0.06, density: 0.003 });
/** Smear band waviness: vertical swing as a fraction of the tile, waves. */
const BOARD_SMEAR_WAVE = Object.freeze({ amplitude: 0.03, waves: 2 });

/**
 * A seamless board texture tile as an RGBA overlay for the flat
 * `BLACKBOARD_BASE_COLOR`: white lightens and black darkens by its alpha.
 * Layers:
 * - low-frequency mottling, ±`BOARD_MOTTLE`;
 * - eraser smears: noise stretched along x, its bands bent by a gentle
 *   periodic wave (a slight, varying slant), lighter by up to `BOARD_SMEAR`;
 * - sparse light specks of chalk dust.
 */
export const generateBlackboardTexture = (
  size: number,
  seed: number,
): Uint8ClampedArray => {
  if (!Number.isInteger(size) || size < 16 || (size & (size - 1)) !== 0) {
    throw new Error(
      `generateBlackboardTexture(): size must be a power of two ≥ 16, got ${size}`,
    );
  }
  if (!Number.isFinite(seed)) {
    throw new Error("generateBlackboardTexture(): seed must be finite");
  }
  const random = mulberry32(seed);
  const coarse = valueNoiseOctave(size, 4, random);
  const medium = valueNoiseOctave(size, 12, random);
  const smear = valueNoise(size, 3, Math.max(4, size / 8), random);
  const phase = random() * Math.PI * 2;
  const swing = size * BOARD_SMEAR_WAVE.amplitude;
  const deltas = new Float32Array(size * size);
  for (let x = 0; x < size; x++) {
    // a whole number of waves across the tile keeps it seamless
    const shift = Math.round(
      swing *
        Math.sin((2 * Math.PI * BOARD_SMEAR_WAVE.waves * x) / size + phase),
    );
    for (let y = 0; y < size; y++) {
      const i = y * size + x;
      const mottle =
        Math.min(
          1,
          Math.max(-1, (0.65 * coarse[i] + 0.35 * medium[i] - 0.5) * 2.5),
        ) * BOARD_MOTTLE;
      const smearRow = (((y + shift) % size) + size) % size;
      const smeared =
        smoothstep(0.6, 0.9, smear[smearRow * size + x]) * BOARD_SMEAR;
      deltas[i] = mottle + smeared;
    }
  }
  const out = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    let delta = deltas[i];
    if (random() < BOARD_SPECK.density) {
      delta += BOARD_SPECK.min + (BOARD_SPECK.max - BOARD_SPECK.min) * random();
    }
    const channel = delta >= 0 ? 255 : 0;
    out[i * 4] = channel;
    out[i * 4 + 1] = channel;
    out[i * 4 + 2] = channel;
    out[i * 4 + 3] = Math.round(Math.abs(delta) * 255);
  }
  return out;
};

/**
 * Maps board-tile texels to the canvas's CSS px for the current view, so the
 * texture is anchored in scene space: it pans with the scene and scales with
 * the zoom (within `BLACKBOARD_PATTERN_SCALE`).
 */
export const getBlackboardPatternTransform = (
  view: Readonly<{ scrollX: number; scrollY: number; zoom: number }>,
): Affine => {
  if (!view || !Number.isFinite(view.zoom) || view.zoom <= 0) {
    throw new Error("getBlackboardPatternTransform(): zoom must be > 0");
  }
  if (!Number.isFinite(view.scrollX) || !Number.isFinite(view.scrollY)) {
    throw new Error("getBlackboardPatternTransform(): scroll must be finite");
  }
  const scale = Math.min(
    BLACKBOARD_PATTERN_SCALE.max,
    Math.max(BLACKBOARD_PATTERN_SCALE.min, view.zoom),
  );
  return {
    a: scale,
    b: 0,
    c: 0,
    d: scale,
    // scene (0, 0) on screen
    e: view.scrollX * view.zoom,
    f: view.scrollY * view.zoom,
  };
};

const TILE_OFFSET_SALT = 0x0ff5e7;
const JITTER_SALT = 0x717e2;

/** Where in the shared tile `seed`'s grain starts, as a fraction of a tile. */
export const getChalkTileOffset = (seed: number): { x: number; y: number } => {
  if (!Number.isFinite(seed)) {
    throw new Error("getChalkTileOffset(): seed must be a finite number");
  }
  const random = mulberry32(seed ^ TILE_OFFSET_SALT);
  return { x: random(), y: random() };
};

/** Offset of the faint second pass over chalk outlines, in scene units. */
export const getChalkJitter = (seed: number): { dx: number; dy: number } => {
  if (!Number.isFinite(seed)) {
    throw new Error("getChalkJitter(): seed must be a finite number");
  }
  const random = mulberry32(seed ^ JITTER_SALT);
  const angle = random() * Math.PI * 2;
  const length = 0.45 + random() * 0.4;
  return { dx: Math.cos(angle) * length, dy: Math.sin(angle) * length };
};

// ---------------------------------------------------------------------------
// affine helpers (DOMMatrix-compatible fields)

export type Affine = Readonly<{
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}>;

export type DeviceRect = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

const assertAffine = (name: string, m: Affine) => {
  if (
    !m ||
    ![m.a, m.b, m.c, m.d, m.e, m.f].every(
      (value) => typeof value === "number" && Number.isFinite(value),
    )
  ) {
    throw new Error(`${name}: transform must have finite a..f`);
  }
};

/** `m · n`: applies `n` first, then `m`. */
export const multiplyAffine = (m: Affine, n: Affine): Affine => {
  assertAffine("multiplyAffine()", m);
  assertAffine("multiplyAffine()", n);
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
};

/**
 * Maps noise-tile pixels to device pixels for each grain pass, given the
 * layer's local-to-device transform `m`: the tile is anchored at the
 * element's origin, shifted by its seed offset, and covers
 * `CHALK_TILE_SCENE_SIZE` local units (× the pass scale).
 */
export const getChalkGrainTransforms = (
  m: Affine,
  seed: number,
): { transform: Affine; strength: number }[] => {
  assertAffine("getChalkGrainTransforms()", m);
  if (!Number.isFinite(seed)) {
    throw new Error("getChalkGrainTransforms(): seed must be finite");
  }
  const offset = getChalkTileOffset(seed);
  return CHALK_GRAIN_PASSES.map((pass, index) => {
    const size = CHALK_TILE_SCENE_SIZE * pass.scale;
    const unitsPerPx = size / CHALK_TILE_SIZE;
    const cos = Math.cos(pass.rotation) * unitsPerPx;
    const sin = Math.sin(pass.rotation) * unitsPerPx;
    // each pass starts at a different point of the tile
    const shift = index === 0 ? offset : { x: offset.y, y: offset.x };
    const local: Affine = {
      a: cos,
      b: sin,
      c: -sin,
      d: cos,
      e: -shift.x * size,
      f: -shift.y * size,
    };
    return { transform: multiplyAffine(m, local), strength: pass.strength };
  });
};

export const invertAffine = (m: Affine): Affine => {
  assertAffine("invertAffine()", m);
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-12) {
    throw new Error("invertAffine(): transform is singular");
  }
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
};

/** Integer device-pixel bounds covering `rect` (local units) under `m`. */
export const transformRectToDeviceBounds = (
  m: Affine,
  rect: DeviceRect,
): DeviceRect => {
  assertAffine("transformRectToDeviceBounds()", m);
  if (
    !rect ||
    ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
  ) {
    throw new Error("transformRectToDeviceBounds(): rect must be finite");
  }
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x, rect.y + rect.height],
    [rect.x + rect.width, rect.y + rect.height],
  ]) {
    xs.push(m.a * x + m.c * y + m.e);
    ys.push(m.b * x + m.d * y + m.f);
  }
  const left = Math.floor(Math.min(...xs));
  const top = Math.floor(Math.min(...ys));
  return {
    x: left,
    y: top,
    width: Math.ceil(Math.max(...xs)) - left,
    height: Math.ceil(Math.max(...ys)) - top,
  };
};

export const intersectDeviceRects = (
  a: DeviceRect,
  b: DeviceRect,
): DeviceRect | null => {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) {
    return null;
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
};
