import rough from "roughjs/bin/rough";

import * as Element from "@excalidraw/element";
import {
  configureObsidianCommonHost,
  OBSIDIAN_COMMON_HOST_PROTOCOL_VERSION,
  type ObsidianCommonHostAdapter,
  type ObsidianCommonHostDisposer,
} from "@excalidraw/common";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { getDefaultAppState } from "../appState";
import * as StaticScene from "../renderer/staticScene";
import { Renderer } from "../scene/Renderer";

import { API } from "./helpers/api";

import type { AppState } from "../types";
import type { StaticCanvasRenderConfig } from "../scene/types";

/**
 * KuszCanvas: the Obsidian host's blackboard and Markdown-text flags change
 * what an element's cached bitmap looks like, so toggling either one must
 * regenerate the bitmap rather than keep serving the stale one.
 */
describe("Obsidian render flags invalidate element bitmaps", () => {
  const flags = { blackboard: false, markdown: false, accent: "#8a5cf5" };
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
    isMarkdownTextRenderingEnabled: () => flags.markdown,
    getAccentColor: () => flags.accent,
  };

  beforeEach(() => {
    flags.blackboard = false;
    flags.markdown = false;
    flags.accent = "#8a5cf5";
    dispose = configureObsidianCommonHost(host);
  });

  afterEach(() => {
    dispose?.();
    dispose = null;
  });

  const setup = (elements: NonDeletedExcalidrawElement[]) => {
    const scene = new Element.Scene(elements, { skipValidation: true });
    const renderer = new Renderer(scene);
    const appState: AppState = {
      ...getDefaultAppState(),
      width: 500,
      height: 500,
      offsetLeft: 0,
      offsetTop: 0,
      scrollX: 0,
      scrollY: 0,
    };
    const { elementsMap, visibleElements } = renderer.getRenderableElements({
      ...appState,
      selectedElements: [],
    });
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 500;
    const renderConfig: StaticCanvasRenderConfig = {
      imageCache: new Map(),
      renderGrid: false,
      isExporting: false,
      scale: 1,
      renderEnvironment: {
        createCanvas: () => document.createElement("canvas"),
        createImage: () => document.createElement("img"),
      },
      canvasBackgroundColor: "#fff",
      embedsValidationStatus: new Map(),
      elementsPendingErasure: new Set(),
      pendingFlowchartNodes: null,
      theme: "light",
    };
    return () =>
      StaticScene.renderStaticScene({
        canvas,
        rc: rough.canvas(canvas),
        scale: 1,
        elementsMap,
        allElementsMap: scene.getNonDeletedElementsMap(),
        visibleElements,
        appState,
        renderConfig,
      });
  };

  it.each([
    ["blackboard", "blackboard"],
    ["markdown", "markdown"],
  ] as const)("regenerates when the %s flag toggles", (_label, flag) => {
    const element = API.createElement({ type: "rectangle" });
    const draw = setup([element]);

    draw();
    const first = Element.elementWithCanvasCache.get(element);
    expect(first).toBeDefined();

    draw();
    expect(Element.elementWithCanvasCache.get(element)).toBe(first);

    flags[flag] = true;
    draw();
    const second = Element.elementWithCanvasCache.get(element);
    expect(second).toBeDefined();
    expect(second).not.toBe(first);

    draw();
    expect(Element.elementWithCanvasCache.get(element)).toBe(second);
  });

  it("regenerates Markdown text when the accent colour changes", () => {
    flags.markdown = true;
    const element = API.createElement({ type: "text", text: "#tag" });
    const draw = setup([element]);

    draw();
    const first = Element.elementWithCanvasCache.get(element);
    expect(first).toBeDefined();

    flags.accent = "#e83e8c";
    draw();
    const second = Element.elementWithCanvasCache.get(element);
    expect(second).not.toBe(first);

    draw();
    expect(Element.elementWithCanvasCache.get(element)).toBe(second);
  });

  it("ignores the accent colour while Markdown rendering is off", () => {
    const element = API.createElement({ type: "text", text: "#tag" });
    const draw = setup([element]);

    draw();
    const first = Element.elementWithCanvasCache.get(element);
    flags.accent = "#e83e8c";
    draw();
    expect(Element.elementWithCanvasCache.get(element)).toBe(first);
  });
});
