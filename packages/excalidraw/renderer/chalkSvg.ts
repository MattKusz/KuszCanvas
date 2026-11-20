/**
 * KuszCanvas: SVG side of blackboard mode (canvas side: `renderChalk.ts`).
 *
 * Each chalked element gets one `<filter>` per chalked layer. The filter
 * thresholds fractal noise into an erase mask and cuts it out of the layer
 * (`feComposite operator="out"`); strokes first gain a faint copy offset by
 * the element's jitter. Filters use `userSpaceOnUse` regions in the element's
 * local units: an `objectBoundingBox` region collapses on straight lines.
 */
import { SVG_NS } from "@excalidraw/common";
import {
  CHALK_JITTER_ALPHA,
  CHALK_LAYERS,
  CHALK_LAYER_STRENGTH,
  getChalkJitter,
} from "@excalidraw/element";

import type { ChalkLayer, DeviceRect } from "@excalidraw/element";

/**
 * Noise in the element's local units, tuned by eye against the canvas tile
 * (`.tmp/cp7/bb-export.cjs` renders both): grain of about 0.5-1 scene units.
 * Noise at or below `eraseFrom` keeps the chalk, at or above `eraseFull`
 * removes it, with partial erase between for the canvas's soft speckle.
 */
export const CHALK_SVG_NOISE = {
  baseFrequency: 0.9,
  numOctaves: 2,
  eraseFrom: 0.4,
  eraseFull: 0.63,
} as const;

type ChalkedLayer = Exclude<ChalkLayer, "solid">;

const assertChalkedLayer = (layer: ChalkLayer, fn: string) => {
  if (layer !== "fill" && layer !== "stroke") {
    throw new Error(`${fn}: layer must be "fill" or "stroke", got ${layer}`);
  }
};

export const getChalkSvgFilterId = (
  elementId: string,
  layer: ChalkLayer,
): string => {
  if (typeof elementId !== "string" || elementId === "") {
    throw new Error("getChalkSvgFilterId: elementId is required");
  }
  assertChalkedLayer(layer, "getChalkSvgFilterId");
  return `kc-chalk-${elementId}-${layer}`;
};

export type ChalkSvgFilterOptions = Readonly<{
  id: string;
  layer: ChalkedLayer;
  seed: number;
  /** the element's paint box in its local units */
  bounds: DeviceRect;
  /** offset second pass (strokes only) */
  jitter: boolean;
}>;

const assertBounds = (bounds: DeviceRect, fn: string) => {
  if (
    !bounds ||
    ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    throw new Error(`${fn}: bounds must be a finite, non-empty rect`);
  }
};

const create = (
  doc: Document,
  tag: string,
  attributes: Record<string, string | number>,
  children: Element[] = [],
): SVGElement => {
  const node = doc.createElementNS(SVG_NS, tag) as SVGElement;
  for (const [name, value] of Object.entries(attributes)) {
    node.setAttribute(name, `${value}`);
  }
  for (const child of children) {
    node.appendChild(child);
  }
  return node;
};

const alphaSlope = (
  doc: Document,
  input: string,
  slope: number,
  result: string,
) =>
  create(doc, "feComponentTransfer", { in: input, result }, [
    create(doc, "feFuncA", { type: "linear", slope }),
  ]);

export const createChalkSvgFilter = (
  doc: Document,
  options: ChalkSvgFilterOptions,
): SVGFilterElement => {
  if (!doc || typeof doc.createElementNS !== "function") {
    throw new Error("createChalkSvgFilter: doc is required");
  }
  if (!options || typeof options.id !== "string" || options.id === "") {
    throw new Error("createChalkSvgFilter: options.id is required");
  }
  assertChalkedLayer(options.layer, "createChalkSvgFilter");
  if (!Number.isFinite(options.seed)) {
    throw new Error("createChalkSvgFilter: seed must be finite");
  }
  assertBounds(options.bounds, "createChalkSvgFilter");

  const { bounds, layer, seed } = options;
  const span = CHALK_SVG_NOISE.eraseFull - CHALK_SVG_NOISE.eraseFrom;
  // alpha = (R - eraseFrom) / span, clamped to [0, 1] by the filter
  const slope = 1 / span;
  const intercept = -CHALK_SVG_NOISE.eraseFrom / span;

  const primitives: Element[] = [
    create(doc, "feTurbulence", {
      type: "fractalNoise",
      baseFrequency: CHALK_SVG_NOISE.baseFrequency,
      numOctaves: CHALK_SVG_NOISE.numOctaves,
      seed: Math.round(seed),
      stitchTiles: "noStitch",
      result: "noise",
    }),
    create(doc, "feColorMatrix", {
      in: "noise",
      type: "matrix",
      values: `0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${slope} 0 0 0 ${intercept}`,
      result: "mask",
    }),
    alphaSlope(doc, "mask", CHALK_LAYER_STRENGTH[layer], "erase"),
  ];

  let source = "SourceGraphic";
  if (layer === "stroke" && options.jitter) {
    const { dx, dy } = getChalkJitter(seed);
    primitives.push(
      create(doc, "feOffset", { in: "SourceGraphic", dx, dy, result: "shift" }),
      alphaSlope(doc, "shift", CHALK_JITTER_ALPHA, "ghost"),
      create(doc, "feMerge", { result: "chalk" }, [
        create(doc, "feMergeNode", { in: "ghost" }),
        create(doc, "feMergeNode", { in: "SourceGraphic" }),
      ]),
    );
    source = "chalk";
  }
  primitives.push(
    create(doc, "feComposite", { in: source, in2: "erase", operator: "out" }),
  );

  return create(
    doc,
    "filter",
    {
      id: options.id,
      filterUnits: "userSpaceOnUse",
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      "color-interpolation-filters": "sRGB",
    },
    primitives,
  ) as SVGFilterElement;
};

export type ChalkSvgGroupOptions = Readonly<{
  elementId: string;
  seed: number;
  bounds: DeviceRect;
  jitter: boolean;
}>;

/**
 * Wraps an element's nodes, sorted by chalk layer, in a `<g>` that paints
 * fill, stroke, then solid (the canvas order), each chalked layer through its
 * own filter. The caller sets the element's transform and opacity on the
 * returned group; the filters live in its user space.
 */
export const buildChalkSvgGroup = (
  doc: Document,
  options: ChalkSvgGroupOptions,
  layers: Readonly<Partial<Record<ChalkLayer, readonly Element[]>>>,
): SVGGElement => {
  if (!doc || typeof doc.createElementNS !== "function") {
    throw new Error("buildChalkSvgGroup: doc is required");
  }
  if (!options || typeof options.elementId !== "string" || !options.elementId) {
    throw new Error("buildChalkSvgGroup: options.elementId is required");
  }
  if (!layers || typeof layers !== "object") {
    throw new Error("buildChalkSvgGroup: layers is required");
  }

  const group = create(doc, "g", {}) as SVGGElement;
  let defs: SVGElement | null = null;
  for (const layer of CHALK_LAYERS) {
    const nodes = layers[layer] ?? [];
    if (nodes.length === 0) {
      continue;
    }
    const layerGroup = create(doc, "g", {}, [...nodes]);
    if (layer !== "solid") {
      const id = getChalkSvgFilterId(options.elementId, layer);
      if (!defs) {
        defs = create(doc, "defs", {});
        group.prepend(defs);
      }
      defs.appendChild(
        createChalkSvgFilter(doc, {
          id,
          layer,
          seed: options.seed,
          bounds: options.bounds,
          jitter: options.jitter,
        }),
      );
      layerGroup.setAttribute("filter", `url(#${id})`);
    }
    group.appendChild(layerGroup);
  }
  return group;
};
