/**
 * KuszCanvas: the blackboard board texture as a WebGL2 fragment shader.
 *
 * The board never repeats: every feature is hashed from integer lattice
 * cells anchored in scene space, so no tile exists to repeat. The board is
 * a flat slate lightened only by erased chalk (eraser strokes, steered by a
 * hidden mottle) and the odd scratch. Each layer is a ladder of octaves
 * whose cells are 2^k scene units wide. Scene-scaled layers (mottle,
 * strokes) keep their octaves at every zoom, so they grow and shrink with
 * the drawing; zoom-scaled ones (scratches) pick octaves by how large their
 * cells look on screen, so they read the same at every zoom.
 *
 * Large scene coordinates would lose float32 precision on the GPU, so the
 * lattice origin of each octave is split here, in float64, into an integer
 * cell and a fraction; the shader only adds small numbers to the fraction.
 *
 * Pure: no DOM, no WebGL calls. The runner lives in
 * `packages/excalidraw/renderer/blackboardShaderCanvas.ts`.
 */

export type BoardLayer = Readonly<{
  id: string;
  /** GLSL uniform name prefix */
  uniform: string;
  /**
   * "zoom": octaves follow the on-screen cell size, so zooming brings in
   * new ones and the layer looks the same at every zoom (fine texture).
   * "scene": octaves are fixed scene sizes that grow and shrink with the
   * zoom like drawn content (smudges); they fade out only once their cells
   * shrink below `BOARD_SCENE_FADE` CSS px.
   */
  scaling: "zoom" | "scene";
  /** cell size at full weight, [lo, lo·2^octaves]: CSS px for "zoom"
   * layers, scene units (CSS px at 100%) for "scene" layers */
  band: readonly [number, number];
  /** octaves in the band (log2(hi / lo), an integer) */
  octaves: number;
  /** uniform slots: every octave with non-zero weight ("zoom": band ± 1
   * octave; "scene": the band's octaves) */
  slots: number;
  /** amplitude at full weight, as a fraction of full brightness */
  gain: number;
  /** amplitude ∝ (cell size / lo)^slope: > 0 favours coarse octaves */
  slope: number;
  /** cell height / width before rotation (1 = isotropic) */
  aspect: number;
  /** largest |rotation| of an octave's lattice, radians (π = any) */
  tilt: number;
  seed: number;
}>;

const layerOf = (
  layer: Omit<BoardLayer, "band" | "slots"> & { lo: number },
): BoardLayer => {
  if (layer.scaling === "scene" && !Number.isInteger(Math.log2(layer.lo))) {
    throw new Error(
      `blackboardShader: scene layer "${layer.id}" needs a power-of-two lo`,
    );
  }
  return Object.freeze({
    id: layer.id,
    uniform: layer.uniform,
    scaling: layer.scaling,
    band: Object.freeze([layer.lo, layer.lo * 2 ** layer.octaves]) as [
      number,
      number,
    ],
    octaves: layer.octaves,
    slots: layer.octaves + (layer.scaling === "scene" ? 1 : 2),
    gain: layer.gain,
    slope: layer.slope,
    aspect: layer.aspect,
    tilt: layer.tilt,
    seed: layer.seed,
  });
};

/**
 * The board's layers. Gains are fractions of full brightness added to
 * `BOARD_SHADER_BASE`; the fragment shader draws and mixes them.
 */
export const BOARD_LAYERS: readonly BoardLayer[] = Object.freeze([
  // where erased chalk lies thick: soft, mostly large, never drawn itself
  layerOf({
    id: "mottle",
    scaling: "scene",
    uniform: "uMottle",
    lo: 64,
    octaves: 5,
    gain: 0.011,
    slope: 0.3,
    aspect: 1.8,
    tilt: 0.3,
    seed: 0x6d6f7474,
  }),
  // erased chalk: eraser strokes, curved bands of felt streaks
  layerOf({
    id: "smear",
    scaling: "scene",
    uniform: "uSmear",
    lo: 256,
    octaves: 1,
    gain: 0.008,
    slope: 0,
    aspect: 1,
    tilt: 0, // strokes set their own angle: keep them left-right
    seed: 0x736d6561,
  }),
  // thin scratches, light and dark
  layerOf({
    id: "scratch",
    scaling: "zoom",
    uniform: "uScratch",
    lo: 160,
    octaves: 2,
    gain: 0.12,
    slope: 0,
    aspect: 1,
    tilt: Math.PI,
    seed: 0x73637261,
  }),
]);

/** Board colour under the texture, sRGB 0..255: slate grey, barely green. */
export const BOARD_SHADER_BASE = Object.freeze([12, 14, 13] as const);
/** Per-channel response to the texture's lightness changes. */
export const BOARD_SHADER_TINT = Object.freeze([1.0, 1.01, 0.99] as const);

/**
 * Edge of the random noise texture the smooth layers sample, texels. Each
 * octave reads it at its own rotation and offset, so an octave repeats only
 * every `BOARD_NOISE_SIZE` cells (> 1,000 cells) and the
 * octaves never line up.
 */
export const BOARD_NOISE_SIZE = 1024;
/** Seed of the noise texture. */
export const BOARD_NOISE_SEED = 0x6b75737a; // "kusz"

/**
 * Eraser strokes per smear cell: `perCell` tries, each drawn with chance
 * `density`.
 *
 * Cost: the board redraws on every pan frame and every try costs a hash
 * per haze pixel for each cell in reach, rejected or not. Benchmark the
 * frame on a weak GPU before raising `perCell`; more than ~1.2 strokes per
 * 256 px square also merges the bands into cloud.
 */
export const BOARD_SMEAR_STROKES = Object.freeze({ perCell: 2, density: 0.6 });

/**
 * Eraser strokes run left-right: each stroke's axis sits within this many
 * radians of horizontal, and its bend turns it into an arc.
 */
export const BOARD_SMEAR_ANGLE_SPREAD = 0.4;

/**
 * Eraser stroke size in smear cells: half its length and half its width,
 * each drawn between the two. Wide for their length: a block eraser.
 */
export const BOARD_SMEAR_SHAPE = Object.freeze({
  halfLength: Object.freeze([0.55, 1.0] as const),
  halfWidth: Object.freeze([0.4, 0.6] as const),
});

/**
 * Inside a stroke: a solid `fill` of erased chalk, shaded ± `texture` by
 * the felt's streaks, so each stroke reads as one band.
 */
export const BOARD_SMEAR_FELT = Object.freeze({ fill: 0.8, texture: 0.25 });

/** A stroke's band fades out by this many half-widths from its middle. */
const SMEAR_SIDE_FADE = 1.02;
/** The deepest arc: the band's middle bows by ½ · bend · along². */
const SMEAR_MAX_BEND = 0.9;

/**
 * Furthest a stroke reaches from its centre along x and y, in smear cells:
 * its half-length, and its widest half-band plus the deepest bow, turned by
 * the widest angle. A pixel only looks at cells whose centres lie this
 * close, three or four a side.
 */
export const BOARD_SMEAR_REACH = (() => {
  const along = BOARD_SMEAR_SHAPE.halfLength[1];
  const across =
    BOARD_SMEAR_SHAPE.halfWidth[1] * SMEAR_SIDE_FADE +
    0.5 * SMEAR_MAX_BEND * along ** 2;
  const turn = BOARD_SMEAR_ANGLE_SPREAD;
  return Object.freeze({
    x: along * Math.cos(turn) + across * Math.sin(turn),
    y: along * Math.sin(turn) + across * Math.cos(turn),
    across,
  });
})();

/** "scene" octaves fade out from this cell size (CSS px) down to half it. */
export const BOARD_SCENE_FADE = 4;

/** Shape constants baked into the fragment shader. */
const FEATURES = Object.freeze({
  /** the mottle adds no tone: it only steers how much chalk the eraser
   * strokes leave */
  mottleWarp: 0.55,
  /** felt streaks per stroke half-width: broad bands and fine lines */
  smearStreaksCoarse: 6,
  smearStreaksFine: 14,
  /** erased-chalk change per unit of mottle */
  residueMottle: 30,
  scratchDensity: 0.28,
  /** scratch width as a fraction of its cell */
  scratchWidth: 0.0028,
  /** share of scratches that are dark gouges, not chalk-filled */
  scratchDark: 0.3,
});

/**
 * Seeded random bytes for the noise texture: `size`² RGBA texels, four
 * independent uniform channels.
 */
export const generateBoardNoise = (size: number, seed: number): Uint8Array => {
  if (!Number.isInteger(size) || size < 16 || (size & (size - 1)) !== 0) {
    throw new Error(
      `generateBoardNoise(): size must be a power of two ≥ 16, got ${size}`,
    );
  }
  if (!Number.isFinite(seed)) {
    throw new Error("generateBoardNoise(): seed must be finite");
  }
  const out = new Uint8Array(size * size * 4);
  const words = new Uint32Array(out.buffer);
  let state = seed >>> 0;
  for (let i = 0; i < words.length; i++) {
    // splitmix32
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    words[i] = (z ^ (z >>> 16)) >>> 0;
  }
  return out;
};

const glslFloat = (value: number) => {
  const text = String(value);
  return text.includes(".") || text.includes("e") ? text : `${text}.0`;
};

// ---------------------------------------------------------------------------
// octave uniforms

export type BoardFrame = Readonly<{
  /** scene coordinates of the region's top-left device pixel */
  sceneX: number;
  sceneY: number;
  /** CSS px per scene unit */
  zoom: number;
  /** device px per CSS px */
  pixelRatio: number;
}>;

export type BoardLayerUniforms = Readonly<{
  /** per slot: lattice fraction x, y; weight; device px per cell */
  lattice: Float32Array;
  /** per slot: lattice units per device px, rows (m00, m01), (m10, m11) */
  matrix: Float32Array;
  /** per slot: lattice cell x, y (wrapping int32); seed; octave k */
  cell: Int32Array;
}>;

const validateLayer = (layer: BoardLayer, caller: string) => {
  if (!layer || typeof layer !== "object" || !Array.isArray(layer.band)) {
    throw new Error(`${caller}: layer is required`);
  }
};

/**
 * Weight of an octave whose cells are `cellCss` CSS px on screen: 1 inside
 * the layer's band, easing to 0 one octave outside it. The ramps are
 * sin/cos in log2 space and the bands span whole octaves, so the summed
 * energy of a layer (Σ weight²) stays constant while zooming.
 */
export const getBoardBandWeight = (
  layer: BoardLayer,
  cellCss: number,
): number => {
  validateLayer(layer, "getBoardBandWeight()");
  if (!Number.isFinite(cellCss) || cellCss <= 0) {
    throw new Error("getBoardBandWeight(): cell size must be > 0");
  }
  const [lo, hi] = layer.band;
  const below = Math.log2(cellCss / lo);
  const above = Math.log2(cellCss / hi);
  if (below <= -1 || above >= 1) {
    return 0;
  }
  if (below < 0) {
    return Math.sin(((below + 1) * Math.PI) / 2);
  }
  if (above > 0) {
    return Math.cos((above * Math.PI) / 2);
  }
  return 1;
};

/** 32-bit integer mix (lowbias32), as in the shader. */
const mixBits = (value: number) => {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
};

/** Weight of a "scene" octave whose cells are `cellCss` CSS px on screen. */
const sceneFade = (cellCss: number) => {
  const above = Math.log2(cellCss / (BOARD_SCENE_FADE / 2));
  if (above <= 0) {
    return 0;
  }
  return above >= 1 ? 1 : Math.sin((above * Math.PI) / 2);
};

/**
 * Per-slot uniforms of `layer` for a region whose top-left device pixel is
 * at (`frame.sceneX`, `frame.sceneY`). Slot `i` holds octave
 * `ceil(log2(lo / 2 / zoom)) + i` of a "zoom" layer (slots outside the band
 * get weight 0), or octave `log2(lo) + i` of a "scene" layer.
 */
export const getBoardLayerUniforms = (
  layer: BoardLayer,
  frame: BoardFrame,
): BoardLayerUniforms => {
  validateLayer(layer, "getBoardLayerUniforms()");
  if (!frame || !Number.isFinite(frame.zoom) || frame.zoom <= 0) {
    throw new Error("getBoardLayerUniforms(): zoom must be > 0");
  }
  if (!Number.isFinite(frame.pixelRatio) || frame.pixelRatio <= 0) {
    throw new Error("getBoardLayerUniforms(): pixelRatio must be > 0");
  }
  if (!Number.isFinite(frame.sceneX) || !Number.isFinite(frame.sceneY)) {
    throw new Error("getBoardLayerUniforms(): scene origin must be finite");
  }
  const { zoom, pixelRatio, sceneX, sceneY } = frame;
  const lattice = new Float32Array(layer.slots * 4);
  const matrix = new Float32Array(layer.slots * 4);
  const cell = new Int32Array(layer.slots * 4);
  const scene = layer.scaling === "scene";
  const first = scene
    ? Math.log2(layer.band[0])
    : Math.ceil(Math.log2(layer.band[0] / 2 / zoom));
  for (let slot = 0; slot < layer.slots; slot++) {
    const k = first + slot;
    const cellScene = 2 ** k;
    const cellCss = cellScene * zoom;
    const seed = mixBits(layer.seed ^ mixBits(k + 0x9e3779b9));
    const weight = scene
      ? sceneFade(cellCss) * layer.gain * 2 ** (slot * layer.slope)
      : getBoardBandWeight(layer, cellCss) *
        layer.gain *
        (cellCss / layer.band[0]) ** layer.slope;
    // lattice = S · R(angle) · scene / cellScene, S = diag(1, 1 / aspect)
    const angle = layer.tilt * ((mixBits(seed ^ 0xa5a5a5a5) / 2 ** 32) * 2 - 1);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const m00 = cos / cellScene;
    const m01 = -sin / cellScene;
    const m10 = sin / (cellScene * layer.aspect);
    const m11 = cos / (cellScene * layer.aspect);
    const originX = m00 * sceneX + m01 * sceneY;
    const originY = m10 * sceneX + m11 * sceneY;
    const cellX = Math.floor(originX);
    const cellY = Math.floor(originY);
    const perPixel = 1 / (zoom * pixelRatio);
    const base = slot * 4;
    lattice[base] = originX - cellX;
    lattice[base + 1] = originY - cellY;
    lattice[base + 2] = weight;
    lattice[base + 3] = cellCss * pixelRatio;
    matrix[base] = m00 * perPixel;
    matrix[base + 1] = m01 * perPixel;
    matrix[base + 2] = m10 * perPixel;
    matrix[base + 3] = m11 * perPixel;
    // Int32Array stores modulo 2^32; the shader's cell hash wraps the same
    cell[base] = cellX % 4294967296;
    cell[base + 1] = cellY % 4294967296;
    cell[base + 2] = seed | 0;
    cell[base + 3] = k;
  }
  return { lattice, matrix, cell };
};

/**
 * The frame of a region that starts `deviceX` × `deviceY` device px from the
 * top-left of a canvas showing `view`.
 */
export const getBoardRegionFrame = (
  view: Readonly<{ scrollX: number; scrollY: number; zoom: number }>,
  pixelRatio: number,
  deviceX: number,
  deviceY: number,
): BoardFrame => {
  if (!view || !Number.isFinite(view.zoom) || view.zoom <= 0) {
    throw new Error("getBoardRegionFrame(): zoom must be > 0");
  }
  if (!Number.isFinite(view.scrollX) || !Number.isFinite(view.scrollY)) {
    throw new Error("getBoardRegionFrame(): scroll must be finite");
  }
  if (!Number.isFinite(pixelRatio) || pixelRatio <= 0) {
    throw new Error("getBoardRegionFrame(): pixelRatio must be > 0");
  }
  if (!Number.isFinite(deviceX) || !Number.isFinite(deviceY)) {
    throw new Error("getBoardRegionFrame(): offset must be finite");
  }
  const perScene = pixelRatio * view.zoom;
  return {
    sceneX: deviceX / perScene - view.scrollX,
    sceneY: deviceY / perScene - view.scrollY,
    zoom: view.zoom,
    pixelRatio,
  };
};

export type BoardChunk = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

/** Splits a `width` × `height` px area into chunks of at most `limit` px. */
export const planBoardChunks = (
  width: number,
  height: number,
  limit: number,
): BoardChunk[] => {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 0 ||
    height < 0
  ) {
    throw new Error("planBoardChunks(): size must be whole px ≥ 0");
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("planBoardChunks(): limit must be a whole px ≥ 1");
  }
  const chunks: BoardChunk[] = [];
  for (let y = 0; y < height; y += limit) {
    for (let x = 0; x < width; x += limit) {
      chunks.push({
        x,
        y,
        width: Math.min(limit, width - x),
        height: Math.min(limit, height - y),
      });
    }
  }
  return chunks;
};

// ---------------------------------------------------------------------------
// shaders

/** A full-screen triangle; no vertex buffers. */
export const BOARD_VERTEX_SHADER = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

/**
 * The haze pass (erased chalk, steered by the mottle) renders at
 * 1 / `BOARD_HAZE_DOWNSCALE` of the device resolution, with a one-texel
 * margin, and the board pass samples it bilinearly. Felt lines finer than
 * two texels fade out rather than alias.
 */
export const BOARD_HAZE_DOWNSCALE = 3;
/** The haze texture stores erased chalk × this in R (RGBA8, so up to 0.25). */
const HAZE_ENCODE = 4;

/** Haze texture size for a region of `width` × `height` device px. */
export const getBoardHazeSize = (
  width: number,
  height: number,
): Readonly<{ width: number; height: number }> => {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 0 ||
    height < 0
  ) {
    throw new Error("getBoardHazeSize(): size must be ≥ 0");
  }
  return {
    width: Math.ceil(width / BOARD_HAZE_DOWNSCALE) + 2,
    height: Math.ceil(height / BOARD_HAZE_DOWNSCALE) + 2,
  };
};

const layerById = (id: string) => {
  const layer = BOARD_LAYERS.find((entry) => entry.id === id);
  if (!layer) {
    throw new Error(`blackboardShader: no layer "${id}"`);
  }
  return layer;
};

/** The layers each program draws. */
export const BOARD_HAZE_LAYERS: readonly BoardLayer[] = Object.freeze([
  layerById("mottle"),
  layerById("smear"),
]);
export const BOARD_DETAIL_LAYERS: readonly BoardLayer[] = Object.freeze([
  layerById("scratch"),
]);

const declare = (layers: readonly BoardLayer[]) =>
  layers
    .map(
      (layer) =>
        `uniform vec4 ${layer.uniform}Lattice[${layer.slots}];\n` +
        `uniform vec4 ${layer.uniform}Matrix[${layer.slots}];\n` +
        `uniform ivec4 ${layer.uniform}Cell[${layer.slots}];\n` +
        `#define ${layer.id.toUpperCase()}_SLOTS ${layer.slots}\n`,
    )
    .join("");

const NOISE_MASK = `${BOARD_NOISE_SIZE - 1}u`;
const NOISE_SIZE = glslFloat(BOARD_NOISE_SIZE);

/** Helpers both programs share. */
const COMMON = `precision highp float;
precision highp int;

uniform vec2 uSize;
uniform sampler2D uNoise;

vec2 latticeOf(vec4 L, vec4 M, vec2 p) {
  return L.xy + vec2(dot(M.xy, p), dot(M.zw, p));
}

// where an octave's lattice starts in the noise texture
vec2 noiseOrigin(ivec4 C) {
  uint seed = uint(C.z);
  return vec2((uvec2(C.xy) + uvec2(seed, seed >> 11)) & uvec2(${NOISE_MASK}));
}

// four random bytes (0..1) of a feature cell; salt picks another four
vec4 cellRandom(ivec2 c, uint seed, uint salt) {
  uvec2 at = uvec2(c) + uvec2(seed, seed >> 11) + salt * uvec2(389u, 769u);
  return texelFetch(uNoise, ivec2(at & uvec2(${NOISE_MASK})), 0);
}

// smooth value noise, four independent channels in -1..1
vec4 smoothNoise(vec2 x) {
  vec2 i = floor(x);
  vec2 f = x - i;
  f = f * f * (3.0 - 2.0 * f);
  return texture(uNoise, (i + f + 0.5) / ${NOISE_SIZE}) * 2.0 - 1.0;
}

// bilinear value noise: crisper, for felt streaks
vec4 linearNoise(vec2 x) {
  return texture(uNoise, (x + 0.5) / ${NOISE_SIZE}) * 2.0 - 1.0;
}
`;

/**
 * The haze pass: erased chalk (R) at
 * 1 / `BOARD_HAZE_DOWNSCALE` resolution. `uSize` is the haze texture's size; texel j (from the top)
 * covers device px (j − ½) × downscale.
 */
export const BOARD_HAZE_FRAGMENT_SHADER = `#version 300 es
${COMMON}
${declare(BOARD_HAZE_LAYERS)}
out vec4 outColor;

float mottleLayer(vec2 p) {
  float sum = 0.0;
  for (int s = 0; s < MOTTLE_SLOTS; s++) {
    vec4 L = uMottleLattice[s];
    if (L.z <= 0.0) continue;
    vec2 x = noiseOrigin(uMottleCell[s]) + latticeOf(L, uMottleMatrix[s], p);
    vec2 warp = smoothNoise(x).rg;
    sum += L.z * smoothNoise(x + ${glslFloat(
      FEATURES.mottleWarp,
    )} * warp + 0.5).b;
  }
  return sum;
}

// erased chalk: block-eraser strokes, each one wide curved band shaded by
// felt streaks running along it, thinning towards the end where the eraser
// lifted. A stroke's centre lies anywhere in its cell and the stroke reaches
// up to BOARD_SMEAR_REACH cells from it, so every pixel looks at the cells
// within that reach: three or four a side.
float smearLayer(vec2 p) {
  float sum = 0.0;
  for (int s = 0; s < SMEAR_SLOTS; s++) {
    vec4 L = uSmearLattice[s];
    if (L.z <= 0.0) continue;
    ivec4 C = uSmearCell[s];
    uint seed = uint(C.z);
    vec2 q = latticeOf(L, uSmearMatrix[s], p);
    float layer = 0.0;
    vec2 reach = vec2(${glslFloat(BOARD_SMEAR_REACH.x)}, ${glslFloat(
  BOARD_SMEAR_REACH.y,
)});
    ivec2 first = ivec2(floor(q - reach));
    ivec2 last = ivec2(floor(q + reach));
    for (int cy = first.y; cy <= last.y; cy++) {
      for (int cx = first.x; cx <= last.x; cx++) {
        vec2 home = vec2(float(cx), float(cy));
        ivec2 c = C.xy + ivec2(cx, cy);
        for (int k = 0; k < ${BOARD_SMEAR_STROKES.perCell}; k++) {
          uint salt = uint(k) * 3u;
          vec4 r0 = cellRandom(c, seed, salt);
          if (r0.x > ${glslFloat(BOARD_SMEAR_STROKES.density)}) continue;
          vec2 d = q - home - r0.yz;
          // mostly left-right, some tilted
          float angle = (r0.w * 2.0 - 1.0) * ${glslFloat(
            BOARD_SMEAR_ANGLE_SPREAD,
          )};
          vec2 t = vec2(cos(angle), sin(angle));
          float along = dot(d, t);
          if (abs(along) > ${glslFloat(
            BOARD_SMEAR_SHAPE.halfLength[1],
          )}) continue;
          // too far to the side for even the widest, most bent stroke
          if (abs(dot(d, vec2(-t.y, t.x))) > ${glslFloat(
            BOARD_SMEAR_REACH.across,
          )}) continue;
          vec4 r1 = cellRandom(c, seed, salt + 1u);
          float halfLength = mix(${glslFloat(
            BOARD_SMEAR_SHAPE.halfLength[0],
          )}, ${glslFloat(BOARD_SMEAR_SHAPE.halfLength[1])}, r1.x);
          float halfWidth = mix(${glslFloat(
            BOARD_SMEAR_SHAPE.halfWidth[0],
          )}, ${glslFloat(BOARD_SMEAR_SHAPE.halfWidth[1])}, r1.y);
          // an arc, never quite straight, bowed up or down
          float bend = r1.z * 2.0 - 1.0;
          bend = sign(bend) * mix(0.3, ${glslFloat(SMEAR_MAX_BEND)}, abs(bend));
          float across = dot(d, vec2(-t.y, t.x)) - 0.5 * bend * along * along;
          float u = along / halfLength;
          float v = abs(across) / halfWidth;
          if (v > ${glslFloat(SMEAR_SIDE_FADE)} || abs(u) > 1.0) continue;
          vec4 r2 = cellRandom(c, seed, salt + 2u);
          // the eraser lifts at one end: the chalk left thins along the stroke
          float lift = smoothstep(-1.0, 1.0, r1.w > 0.5 ? u : -u);
          // rounded ends: the fade starts sooner towards the sides
          float ends = (1.0 - smoothstep(0.55, 1.0, abs(u) + 0.3 * v * v)) *
            mix(1.0, 0.3, lift);
          float sides = 1.0 - smoothstep(0.82, ${glslFloat(
            SMEAR_SIDE_FADE,
          )}, v);
          // felt streaks shade the band: broad ones and fine ones, the fine
          // faded out before they shrink below two haze texels
          vec2 o = r2.xy * ${NOISE_SIZE};
          float coarse = linearNoise(vec2(
            across / halfWidth * ${glslFloat(FEATURES.smearStreaksCoarse)},
            along * 0.6
          ) + o).r;
          float fine = linearNoise(vec2(
            across / halfWidth * ${glslFloat(FEATURES.smearStreaksFine)},
            along * 1.5
          ) + o.yx).g;
          float finePx = halfWidth * L.w / ${glslFloat(
            FEATURES.smearStreaksFine,
          )};
          fine *= smoothstep(
            ${glslFloat(1.5 * BOARD_HAZE_DOWNSCALE)},
            ${glslFloat(3 * BOARD_HAZE_DOWNSCALE)},
            finePx
          );
          float felt = clamp(
            ${glslFloat(BOARD_SMEAR_FELT.fill)} +
              ${glslFloat(
                BOARD_SMEAR_FELT.texture,
              )} * (0.4 * coarse + 0.6 * fine),
            0.0,
            1.0
          );
          layer += ends * sides * felt * mix(0.35, 1.0, r2.z);
        }
      }
    }
    sum += L.z * layer;
  }
  return sum;
}

void main() {
  vec2 p = (vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y) - 1.0)
    * ${glslFloat(BOARD_HAZE_DOWNSCALE)};
  float mottle = mottleLayer(p);
  // erased chalk lies thicker in some parts of the board than others
  float residue = smearLayer(p)
    * clamp(1.0 + mottle * ${glslFloat(FEATURES.residueMottle)}, 0.4, 1.8);
  // only the erased chalk leaves this pass: the board between strokes
  // stays one flat slate
  outColor = vec4(residue * ${glslFloat(HAZE_ENCODE)}, 0.0, 0.0, 1.0);
}
`;

/**
 * The board pass. `p` is the device pixel from the region's top-left
 * (y down); each layer loops over its octave slots, skipping weight-0 ones.
 *
 * Smooth layers read `uNoise` (four random channels, bilinear, repeating)
 * at lattice coordinates wrapped to the texture: the integer cell is masked
 * to the texture size, so far scene coordinates lose no precision.
 * Scratches sit inside their own cell and read their random numbers from
 * `uNoise` too.
 */
export const BOARD_FRAGMENT_SHADER = `#version 300 es
${COMMON}
uniform vec3 uBase;
uniform vec3 uTint;
uniform sampler2D uHaze;
uniform vec2 uHazeSize;
${declare(BOARD_DETAIL_LAYERS)}
out vec4 outColor;

// erased chalk from the haze pass
float residueAt(vec2 p) {
  vec2 texel = p / ${glslFloat(BOARD_HAZE_DOWNSCALE)} + 1.0;
  vec2 uv = vec2(texel.x / uHazeSize.x, 1.0 - texel.y / uHazeSize.y);
  return texture(uHaze, uv).r / ${glslFloat(HAZE_ENCODE)};
}

// thin scratches inside their own cell, anti-aliased in device px and
// dimmed rather than thinned below one px
float scratchLayer(vec2 p) {
  float sum = 0.0;
  for (int s = 0; s < SCRATCH_SLOTS; s++) {
    vec4 L = uScratchLattice[s];
    if (L.z <= 0.0) continue;
    ivec4 C = uScratchCell[s];
    uint seed = uint(C.z);
    vec2 q = latticeOf(L, uScratchMatrix[s], p);
    vec2 iq = floor(q);
    ivec2 c = C.xy + ivec2(iq);
    vec4 r0 = cellRandom(c, seed, 0u);
    if (r0.x > ${glslFloat(FEATURES.scratchDensity)}) continue;
    vec4 r1 = cellRandom(c, seed, 1u);
    vec2 centre = vec2(0.38) + 0.24 * r0.yz;
    float angle = r0.w * 6.2831853;
    vec2 t = vec2(cos(angle), sin(angle));
    float halfLength = mix(0.06, 0.34, r1.x * r1.x);
    vec2 d = q - iq - centre;
    float along = dot(d, t);
    if (abs(along) > halfLength) continue;
    float bend = (r1.y * 2.0 - 1.0) * 0.6;
    float across = dot(d, vec2(-t.y, t.x)) - 0.5 * bend * along * along;
    float widthPx = ${glslFloat(
      FEATURES.scratchWidth,
    )} * L.w * mix(0.6, 1.5, r1.z);
    float drawn = max(widthPx, 1.0);
    float cover = clamp(drawn * 0.5 + 0.5 - abs(across) * L.w, 0.0, 1.0);
    if (cover <= 0.0) continue;
    vec4 r2 = cellRandom(c, seed, 2u);
    float taper = 1.0 - smoothstep(0.4, 1.0, abs(along) / halfLength);
    // chalk catches in the scratch unevenly
    float broken = clamp(
      0.45 + 1.2 * linearNoise(vec2(along / halfLength * 6.0, 0.0) + r2.xy * ${NOISE_SIZE}).a,
      0.0,
      1.0
    );
    float strength = cover * min(widthPx, 1.0) * taper * broken * mix(0.35, 1.0, r1.w);
    sum += L.z * strength * (r2.z < ${glslFloat(
      FEATURES.scratchDark,
    )} ? -0.3 : 1.0);
  }
  return sum;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y);
  float residue = residueAt(p);
  // a flat slate: only erased chalk and the odd scratch lighten it
  float lum = residue + scratchLayer(p);
  vec3 colour = uBase + lum * uTint;
  // ±½ step of dither against banding in the dark gradients
  vec4 dither = texelFetch(uNoise, ivec2(gl_FragCoord.xy) & ivec2(${
    BOARD_NOISE_SIZE - 1
  }), 0);
  colour += (dither.a - 0.5) / 255.0;
  outColor = vec4(clamp(colour, 0.0, 1.0), 1.0);
}
`;
