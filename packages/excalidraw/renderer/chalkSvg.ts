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
  BLACKBOARD_BASE_COLOR,
  BOARD_SHADER_BASE,
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
  const region = {
    id: options.id,
    filterUnits: "userSpaceOnUse",
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    "color-interpolation-filters": "sRGB",
  };
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

  return create(doc, "filter", region, primitives) as SVGFilterElement;
};

/**
 * The board texture as SVG turbulence, in the export's user units (scene
 * units at export scale 1), fitted against the shader board
 * (`blackboardShader.ts`) at zoom 1 by comparing their per-scale contrast.
 * Like the shader's smudges, it scales with the drawing and never repeats.
 * Gains are overlay alphas: white lightens, black darkens.
 */
export const BLACKBOARD_SVG_TEXTURE = {
  /** erased chalk: felt streaks (fine `across`, long `along`), lit where
   * the noise passes `from` */
  streaks: {
    across: 0.05,
    along: 0.004,
    numOctaves: 2,
    slope: 2.5,
    from: 0.45,
  },
  /** bends the streaks into eraser arcs: displacement up to `scale` units */
  warp: { baseFrequency: 0.0012, scale: 200 },
  /** patches holding erased chalk: steep cut of coarse noise */
  patch: { baseFrequency: 0.003, numOctaves: 2, slope: 2, from: 0 },
  /** strongest alpha of the erased chalk */
  residue: 0.03,
} as const;

/** Black over the flat base that darkens it to the shader's base. */
const BOARD_SHADE = (() => {
  const green = parseInt(BLACKBOARD_BASE_COLOR.slice(3, 5), 16);
  return Math.max(0, 1 - BOARD_SHADER_BASE[1] / Math.max(green, 1));
})();

/** White (or black) whose alpha is `a·R + b` of `input`'s red channel. */
const alphaFromRed = (
  doc: Document,
  input: string,
  white: boolean,
  a: number,
  b: number,
  result: string,
) => {
  const c = white ? 1 : 0;
  return create(doc, "feColorMatrix", {
    in: input,
    type: "matrix",
    values: `0 0 0 0 ${c}  0 0 0 0 ${c}  0 0 0 0 ${c}  ${a} 0 0 0 ${b}`,
    result,
  });
};

/**
 * A filter for the export's background `<rect>` (filled with
 * `BLACKBOARD_BASE_COLOR`) that overlays the board texture: a flat slate
 * with erased chalk (felt streaks bent into arcs, in patches).
 * Headless: no canvas needed.
 */
export const createBlackboardSvgFilter = (
  doc: Document,
  id: string,
): SVGFilterElement => {
  if (!doc || typeof doc.createElementNS !== "function") {
    throw new Error("createBlackboardSvgFilter: doc is required");
  }
  if (typeof id !== "string" || id === "") {
    throw new Error("createBlackboardSvgFilter: id is required");
  }
  const { streaks, warp, patch, residue } = BLACKBOARD_SVG_TEXTURE;
  const turbulence = (
    baseFrequency: number | string,
    numOctaves: number,
    seed: number,
    result: string,
  ) =>
    create(doc, "feTurbulence", {
      type: "fractalNoise",
      baseFrequency,
      numOctaves,
      seed,
      stitchTiles: "noStitch",
      result,
    });
  // erased chalk: streaks running left-right, bent into arcs by the warp
  const smudge = (name: string, seed: number) => {
    const frequency = `${streaks.along} ${streaks.across}`;
    return [
      turbulence(frequency, streaks.numOctaves, seed, `${name}Noise`),
      create(doc, "feDisplacementMap", {
        in: `${name}Noise`,
        in2: "warp",
        scale: warp.scale,
        xChannelSelector: "R",
        yChannelSelector: "G",
        result: `${name}Bent`,
      }),
      // the displacement samples nearest px: soften its steps
      create(doc, "feGaussianBlur", {
        in: `${name}Bent`,
        stdDeviation: 1,
        result: `${name}Soft`,
      }),
      alphaFromRed(
        doc,
        `${name}Soft`,
        true,
        streaks.slope,
        -streaks.slope * streaks.from,
        `${name}Lines`,
      ),
      turbulence(
        patch.baseFrequency,
        patch.numOctaves,
        seed + 1,
        `${name}Area`,
      ),
      alphaFromRed(
        doc,
        `${name}Area`,
        true,
        patch.slope,
        -patch.slope * patch.from,
        `${name}Patch`,
      ),
      create(doc, "feComposite", {
        in: `${name}Lines`,
        in2: `${name}Patch`,
        operator: "in",
        result: `${name}Full`,
      }),
      alphaSlope(doc, `${name}Full`, residue, name),
    ];
  };
  return create(
    doc,
    "filter",
    {
      id,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      "color-interpolation-filters": "sRGB",
    },
    [
      create(doc, "feFlood", {
        "flood-color": "#000000",
        "flood-opacity": BOARD_SHADE,
        result: "shade",
      }),
      turbulence(warp.baseFrequency, 1, 23, "warp"),
      // two independent sets: more, overlapping strokes
      ...smudge("smudgeA", 29),
      ...smudge("smudgeB", 31),
      create(
        doc,
        "feMerge",
        {},
        ["SourceGraphic", "shade", "smudgeA", "smudgeB"].map((input) =>
          create(doc, "feMergeNode", { in: input }),
        ),
      ),
      // keep the overlay inside the rect
      create(doc, "feComposite", { in2: "SourceGraphic", operator: "in" }),
    ],
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
