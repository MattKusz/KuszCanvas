/**
 * KuszCanvas: canvas side of blackboard mode (see `blackboard.ts`).
 *
 * `drawChalked` paints an element one layer at a time into a scratch canvas
 * that shares the target's transform, erases grain from the layer with a
 * seeded noise tile (`destination-out`) and composites the layer onto the
 * target. The target's own pixels (scene background, export background,
 * elements below) are never touched by the erase.
 *
 * The noise tile and the scratch canvas are created per owning document, so
 * a view moved to a popout window never draws a canvas from another window.
 */
import {
  CHALK_JITTER_ALPHA,
  CHALK_LAYERS,
  CHALK_LAYER_STRENGTH,
  CHALK_TILE_SEED,
  CHALK_TILE_SIZE,
  generateChalkNoise,
  getChalkGrainTransforms,
  getChalkJitter,
  intersectDeviceRects,
  invertAffine,
  transformRectToDeviceBounds,
} from "./blackboard";

import type { Affine, ChalkLayer, DeviceRect } from "./blackboard";
import type { RenderEnvironment } from "./renderEnvironment";

/**
 * Draws `layer` of the element on `context` (already in the element's local
 * transform). Returns whether it painted anything.
 */
export type ChalkLayerDraw = (
  context: CanvasRenderingContext2D,
  layer: ChalkLayer,
) => boolean;

export type DrawChalkedOptions = Readonly<{
  /**
   * What the element may paint, in the target's current (local) units; null
   * for the whole target canvas (a per-element cache canvas).
   */
  localBounds: DeviceRect | null;
  /** element seed: picks the grain offset and jitter direction */
  seed: number;
  /** offset second pass over the stroke layer (not for text) */
  jitter: boolean;
  environment: RenderEnvironment;
  draw: ChalkLayerDraw;
}>;

type ResourceKey = object;

const chalkTiles = new WeakMap<ResourceKey, HTMLCanvasElement>();
const scratchCanvases = new WeakMap<ResourceKey, HTMLCanvasElement>();

/** The document that owns `context`'s canvas, else the render environment. */
const getResourceKey = (
  context: CanvasRenderingContext2D,
  environment: RenderEnvironment,
): ResourceKey =>
  (context.canvas as HTMLCanvasElement | undefined)?.ownerDocument ??
  environment;

const createCanvasFor = (
  key: ResourceKey,
  environment: RenderEnvironment,
): HTMLCanvasElement =>
  typeof (key as Document).createElement === "function"
    ? (key as Document).createElement("canvas")
    : environment.createCanvas();

const getChalkTile = (
  key: ResourceKey,
  environment: RenderEnvironment,
): HTMLCanvasElement | null => {
  const cached = chalkTiles.get(key);
  if (cached) {
    return cached;
  }
  const tile = createCanvasFor(key, environment);
  tile.width = CHALK_TILE_SIZE;
  tile.height = CHALK_TILE_SIZE;
  const tileContext = tile.getContext("2d");
  if (!tileContext || typeof tileContext.createImageData !== "function") {
    return null;
  }
  const noise = generateChalkNoise(CHALK_TILE_SIZE, CHALK_TILE_SEED);
  const image = tileContext.createImageData(CHALK_TILE_SIZE, CHALK_TILE_SIZE);
  for (let i = 0; i < noise.length; i++) {
    // black with the erase alpha: destination-out removes that much
    image.data[i * 4 + 3] = noise[i];
  }
  tileContext.putImageData(image, 0, 0);
  chalkTiles.set(key, tile);
  return tile;
};

const getScratchCanvas = (
  key: ResourceKey,
  environment: RenderEnvironment,
): HTMLCanvasElement => {
  let scratch = scratchCanvases.get(key);
  if (!scratch) {
    scratch = createCanvasFor(key, environment);
    scratchCanvases.set(key, scratch);
  }
  return scratch;
};

const toAffine = (matrix: DOMMatrix | Affine): Affine => ({
  a: matrix.a,
  b: matrix.b,
  c: matrix.c,
  d: matrix.d,
  e: matrix.e,
  f: matrix.f,
});

const setTransform = (context: CanvasRenderingContext2D, m: Affine) =>
  context.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);

/** Erases grain from everything on `context` (a layer in transform `m`). */
const eraseGrain = (
  context: CanvasRenderingContext2D,
  m: Affine,
  tile: HTMLCanvasElement,
  seed: number,
  strength: number,
) => {
  const pattern = context.createPattern(tile, "repeat");
  if (!pattern) {
    return;
  }
  const canvasRect: DeviceRect = {
    x: 0,
    y: 0,
    width: context.canvas.width,
    height: context.canvas.height,
  };
  for (const pass of getChalkGrainTransforms(m, seed)) {
    // the layer canvas, in tile pixels
    const cover = transformRectToDeviceBounds(
      invertAffine(pass.transform),
      canvasRect,
    );
    context.save();
    setTransform(context, pass.transform);
    context.globalCompositeOperation = "destination-out";
    context.globalAlpha = strength * pass.strength;
    context.fillStyle = pattern;
    context.fillRect(cover.x, cover.y, cover.width, cover.height);
    context.restore();
  }
};

/** Overlays a faint copy of the layer, offset by the element's jitter. */
const drawJitterPass = (
  context: CanvasRenderingContext2D,
  m: Affine,
  seed: number,
) => {
  const { dx, dy } = getChalkJitter(seed);
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = CHALK_JITTER_ALPHA;
  context.drawImage(context.canvas, m.a * dx + m.c * dy, m.b * dx + m.d * dy);
  context.restore();
};

/**
 * Paints an element as chalk onto `target`. See the module comment.
 *
 * Falls back to a plain draw (no grain) on a canvas without
 * `getTransform` — a non-DOM canvas the renderer may be handed.
 */
export const drawChalked = (
  target: CanvasRenderingContext2D,
  options: DrawChalkedOptions,
): void => {
  if (!target || !target.canvas) {
    throw new Error("drawChalked(): target context is required");
  }
  if (!options || typeof options.draw !== "function") {
    throw new Error("drawChalked(): options.draw is required");
  }
  if (!Number.isFinite(options.seed)) {
    throw new Error("drawChalked(): options.seed must be finite");
  }
  if (!options.environment) {
    throw new Error("drawChalked(): options.environment is required");
  }

  // UNTOUCHABLE: non-DOM canvases (node-canvas, test mocks) may lack these;
  // they render solid rather than fail the whole scene
  if (
    typeof target.getTransform !== "function" ||
    typeof target.createPattern !== "function"
  ) {
    for (const layer of CHALK_LAYERS) {
      options.draw(target, layer);
    }
    return;
  }

  const m = toAffine(target.getTransform());
  const canvasRect: DeviceRect = {
    x: 0,
    y: 0,
    width: target.canvas.width,
    height: target.canvas.height,
  };
  const rect = options.localBounds
    ? intersectDeviceRects(
        transformRectToDeviceBounds(m, options.localBounds),
        canvasRect,
      )
    : canvasRect;
  if (!rect || rect.width < 1 || rect.height < 1) {
    return;
  }

  const key = getResourceKey(target, options.environment);
  const tile = getChalkTile(key, options.environment);
  const scratch = getScratchCanvas(key, options.environment);
  if (scratch.width !== rect.width || scratch.height !== rect.height) {
    scratch.width = rect.width;
    scratch.height = rect.height;
  }
  const layerContext = scratch.getContext("2d");
  if (!layerContext) {
    throw new Error("drawChalked(): scratch canvas has no 2d context");
  }
  // the layer sees the target's transform, shifted to the scratch origin
  const layerTransform: Affine = { ...m, e: m.e - rect.x, f: m.f - rect.y };

  for (const layer of CHALK_LAYERS) {
    layerContext.save();
    layerContext.setTransform(1, 0, 0, 1, 0, 0);
    layerContext.clearRect(0, 0, scratch.width, scratch.height);
    layerContext.restore();

    layerContext.save();
    setTransform(layerContext, layerTransform);
    const painted = options.draw(layerContext, layer);
    layerContext.restore();
    if (!painted) {
      continue;
    }

    if (layer !== "solid") {
      if (layer === "stroke" && options.jitter) {
        drawJitterPass(layerContext, layerTransform, options.seed);
      }
      if (tile) {
        eraseGrain(
          layerContext,
          layerTransform,
          tile,
          options.seed,
          CHALK_LAYER_STRENGTH[layer],
        );
      }
    }

    // keeps the target's alpha, clip and composite operation
    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.drawImage(scratch, rect.x, rect.y);
    target.restore();
  }
};
