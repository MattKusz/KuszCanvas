/**
 * KuszCanvas: SVG side of blackboard mode -- per-element chalk filters.
 */
import {
  configureObsidianCommonHost,
  FONT_FAMILY,
  OBSIDIAN_COMMON_HOST_PROTOCOL_VERSION,
  SVG_NS,
  type ObsidianCommonHostAdapter,
  type ObsidianCommonHostDisposer,
} from "@excalidraw/common";
import { CHALK_LAYER_STRENGTH, getChalkJitter } from "@excalidraw/element";
import { pointFrom, type LocalPoint } from "@excalidraw/math";

import { exportToSvg } from "../obsidianExport";

import {
  buildChalkSvgGroup,
  createChalkSvgFilter,
  getChalkSvgFilterId,
} from "../renderer/chalkSvg";

import { API } from "./helpers/api";

const bounds = { x: -24, y: -30, width: 248, height: 150 };

const node = (tag = "path") => document.createElementNS(SVG_NS, tag);

describe("getChalkSvgFilterId", () => {
  it("is unique per element and layer", () => {
    expect(getChalkSvgFilterId("abc", "fill")).toBe("kc-chalk-abc-fill");
    expect(getChalkSvgFilterId("abc", "stroke")).toBe("kc-chalk-abc-stroke");
  });

  it("rejects the solid layer and an empty id", () => {
    expect(() => getChalkSvgFilterId("abc", "solid")).toThrow();
    expect(() => getChalkSvgFilterId("", "fill")).toThrow();
  });
});

describe("createChalkSvgFilter", () => {
  const make = (
    layer: "fill" | "stroke",
    jitter = true,
    seed = 12345,
  ): SVGFilterElement =>
    createChalkSvgFilter(document, {
      id: getChalkSvgFilterId("el", layer),
      layer,
      seed,
      bounds,
      jitter,
    });

  it("covers the element's local box in user space", () => {
    const filter = make("stroke");
    expect(filter.tagName).toBe("filter");
    expect(filter.getAttribute("id")).toBe("kc-chalk-el-stroke");
    expect(filter.getAttribute("filterUnits")).toBe("userSpaceOnUse");
    expect(filter.getAttribute("x")).toBe("-24");
    expect(filter.getAttribute("y")).toBe("-30");
    expect(filter.getAttribute("width")).toBe("248");
    expect(filter.getAttribute("height")).toBe("150");
    expect(filter.getAttribute("color-interpolation-filters")).toBe("sRGB");
  });

  it("seeds the noise with the element seed and erases with it", () => {
    const filter = make("fill", true, 777);
    const turbulence = filter.querySelector("feTurbulence")!;
    expect(turbulence.getAttribute("type")).toBe("fractalNoise");
    expect(turbulence.getAttribute("seed")).toBe("777");
    const composite = filter.querySelector("feComposite")!;
    expect(composite.getAttribute("operator")).toBe("out");
    expect(composite.getAttribute("in2")).toBe("erase");
  });

  it("erases fills more lightly than strokes", () => {
    const slope = (filter: SVGFilterElement) =>
      Number(filter.querySelector("feFuncA")!.getAttribute("slope"));
    expect(slope(make("fill"))).toBeCloseTo(CHALK_LAYER_STRENGTH.fill);
    expect(slope(make("stroke"))).toBeCloseTo(CHALK_LAYER_STRENGTH.stroke);
    expect(slope(make("fill"))).toBeLessThan(slope(make("stroke")));
  });

  it("adds the jittered second pass to strokes only", () => {
    const { dx, dy } = getChalkJitter(12345);
    const offset = make("stroke").querySelector("feOffset")!;
    expect(Number(offset.getAttribute("dx"))).toBeCloseTo(dx);
    expect(Number(offset.getAttribute("dy"))).toBeCloseTo(dy);
    expect(make("fill").querySelector("feOffset")).toBeNull();
    expect(make("stroke", false).querySelector("feOffset")).toBeNull();
  });

  it("validates its inputs", () => {
    const base = {
      id: "x",
      layer: "fill" as const,
      seed: 1,
      bounds,
      jitter: false,
    };
    expect(() =>
      createChalkSvgFilter(document, { ...base, layer: "solid" as any }),
    ).toThrow();
    expect(() =>
      createChalkSvgFilter(document, { ...base, seed: NaN }),
    ).toThrow();
    expect(() =>
      createChalkSvgFilter(document, {
        ...base,
        bounds: { ...bounds, width: 0 },
      }),
    ).toThrow();
    expect(() => createChalkSvgFilter(document, { ...base, id: "" })).toThrow();
  });
});

describe("buildChalkSvgGroup", () => {
  const options = { elementId: "el", seed: 9, bounds, jitter: true };

  it("stacks fill, stroke, solid with a filter on the chalked layers", () => {
    const fill = node();
    const stroke = node();
    const solid = node("text");
    const group = buildChalkSvgGroup(document, options, {
      solid: [solid],
      stroke: [stroke],
      fill: [fill],
    });
    const layers = Array.from(group.children).filter(
      (child) => child.tagName === "g",
    );
    expect(layers.map((layer) => layer.firstChild)).toEqual([
      fill,
      stroke,
      solid,
    ]);
    expect(layers[0].getAttribute("filter")).toBe("url(#kc-chalk-el-fill)");
    expect(layers[1].getAttribute("filter")).toBe("url(#kc-chalk-el-stroke)");
    expect(layers[2].hasAttribute("filter")).toBe(false);
    const ids = Array.from(group.querySelectorAll("defs > filter")).map((f) =>
      f.getAttribute("id"),
    );
    expect(ids).toEqual(["kc-chalk-el-fill", "kc-chalk-el-stroke"]);
  });

  it("skips empty layers and needs no defs for solid-only content", () => {
    const solid = node("text");
    const group = buildChalkSvgGroup(document, options, {
      fill: [],
      solid: [solid],
    });
    expect(group.querySelector("defs")).toBeNull();
    expect(group.querySelector("filter")).toBeNull();
    expect(group.children).toHaveLength(1);
    expect(group.firstElementChild!.firstChild).toBe(solid);
  });

  it("validates its inputs", () => {
    expect(() =>
      buildChalkSvgGroup(document, { ...options, elementId: "" }, {}),
    ).toThrow();
    expect(() => buildChalkSvgGroup(document, options, null as any)).toThrow();
  });
});

describe("SVG export in blackboard mode", () => {
  const flags = { blackboard: true };
  let dispose: ObsidianCommonHostDisposer | null = null;

  const host: ObsidianCommonHostAdapter = {
    protocolVersion: OBSIDIAN_COMMON_HOST_PROTOCOL_VERSION,
    getDeviceInfo: () => null,
    getDesktopUIMode: () => "tray",
    getPreferredUIMode: () => "tray",
    getCanvasLimits: () => ({
      areaLimit: 16_777_216,
      widthHeightLimit: 32_767,
    }),
    getHighlightColor: () => "#0076ff",
    isBlackboardModeEnabled: () => flags.blackboard,
    isMarkdownTextRenderingEnabled: () => false,
    getAccentColor: () => "#8a5cf5",
  };

  beforeEach(() => {
    flags.blackboard = true;
    dispose = configureObsidianCommonHost(host);
  });

  afterEach(() => {
    dispose?.();
    dispose = null;
  });

  const exportOne = async (
    element: ReturnType<typeof API.createElement>,
    dark = true,
    extra: ReturnType<typeof API.createElement>[] = [],
  ) =>
    exportToSvg({
      elements: [element, ...extra],
      files: {},
      appState: { exportWithDarkMode: dark, exportBackground: true },
      skipInliningFonts: true,
    });

  const filtersOf = (svg: SVGSVGElement, id: string) =>
    Array.from(svg.querySelectorAll("filter"))
      .map((filter) => filter.getAttribute("id")!)
      .filter((filterId) => filterId.startsWith(`kc-chalk-${id}-`))
      .sort();

  it("chalks a sketchy rectangle's fill and stroke in dark theme", async () => {
    const rect = API.createElement({
      type: "rectangle",
      roughness: 1,
      backgroundColor: "#ffc9c9",
      fillStyle: "solid",
    });
    const svg = await exportOne(rect);
    expect(filtersOf(svg, rect.id)).toEqual([
      `kc-chalk-${rect.id}-fill`,
      `kc-chalk-${rect.id}-stroke`,
    ]);
    const filtered = svg.querySelector(
      `[filter="url(#kc-chalk-${rect.id}-stroke)"]`,
    )!;
    // the filter's user space is the element's local space
    expect(filtered.closest("[transform]")).not.toBeNull();
  });

  it("keeps architect shapes, light theme and disabled mode solid", async () => {
    const solid = API.createElement({ type: "rectangle", roughness: 0 });
    expect(filtersOf(await exportOne(solid), solid.id)).toEqual([]);

    const sketchy = API.createElement({ type: "rectangle", roughness: 1 });
    expect(filtersOf(await exportOne(sketchy, false), sketchy.id)).toEqual([]);

    flags.blackboard = false;
    expect(filtersOf(await exportOne(sketchy), sketchy.id)).toEqual([]);
  });

  it("chalks lines, arrows and freedraw", async () => {
    const arrow = API.createElement({ type: "arrow", roughness: 1 });
    expect(filtersOf(await exportOne(arrow), arrow.id)).toEqual([
      `kc-chalk-${arrow.id}-stroke`,
    ]);
    const freedraw = API.createElement({
      type: "freedraw",
      roughness: 0,
      points: [
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(40, 20),
        pointFrom<LocalPoint>(80, 0),
      ],
    });
    expect(filtersOf(await exportOne(freedraw), freedraw.id)).toEqual([
      `kc-chalk-${freedraw.id}-stroke`,
    ]);
  });

  it("chalks Excalifont text only", async () => {
    const chalk = API.createElement({
      type: "text",
      text: "chalk",
      fontFamily: FONT_FAMILY.Excalifont,
    });
    expect(filtersOf(await exportOne(chalk), chalk.id)).toEqual([
      `kc-chalk-${chalk.id}-stroke`,
    ]);
    const plain = API.createElement({
      type: "text",
      text: "plain",
      fontFamily: FONT_FAMILY.Nunito,
    });
    expect(filtersOf(await exportOne(plain), plain.id)).toEqual([]);
  });

  it("never chalks sticky notes or their text", async () => {
    const note = API.createElement({ type: "stickynote", roughness: 1 });
    const text = API.createElement({
      type: "text",
      text: "note",
      fontFamily: FONT_FAMILY.Excalifont,
      containerId: note.id,
    });
    const svg = await exportOne(
      { ...note, boundElements: [{ id: text.id, type: "text" }] },
      true,
      [text],
    );
    expect(filtersOf(svg, note.id)).toEqual([]);
    expect(filtersOf(svg, text.id)).toEqual([]);
  });
});
