import { RoughCanvas } from "roughjs/bin/canvas";

import {
  FRAME_STYLE,
  ROUNDNESS,
  THEME,
  applyDarkModeFilter,
} from "@excalidraw/common";
import {
  FRAME_SHAPE_STYLE,
  newElement,
  newFrameElement,
  newMagicFrameElement,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawFrameElement,
  FractionalIndex,
  NonDeleted,
  NonDeletedExcalidrawElement,
  NonDeletedSceneElementsMap,
} from "@excalidraw/element/types";

import {
  actionChangeFillStyle,
  actionChangeRoundness,
  actionChangeStrokeColor,
  changeProperty,
} from "../actions/actionProperties";
import { wrapInFrame } from "../actions/actionFrame";
import { getDefaultAppState } from "../appState";
import { getShapeActionPredicates } from "../components/shapeActionPredicates";
import { renderNewElementScene } from "../renderer/renderNewElementScene";
import { exportScene } from "../scene/export";

import type { RenderableElementsMap } from "../scene/types";
import type { AppClassProperties, AppState } from "../types";

const HOST_FRAME_COLOR = {
  stroke: "#123456",
  fill: "rgba(1, 2, 3, 0.2)",
  nameColor: "#654321",
};

const SHAPE_STYLE = {
  strokeColor: "#1971c2",
  backgroundColor: "#ffc9c9",
  fillStyle: "solid",
  strokeWidth: 4,
  strokeStyle: "solid",
  roughness: 1,
  roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
} as const;

const shapeFrame = (
  overrides: Partial<NonDeleted<ExcalidrawFrameElement>> = {},
): NonDeleted<ExcalidrawFrameElement> => ({
  ...newFrameElement({
    x: 0,
    y: 0,
    width: 200,
    height: 150,
    ...SHAPE_STYLE,
    customData: { frameStyle: FRAME_SHAPE_STYLE },
  }),
  id: "frame",
  seed: 1234,
  index: "a2" as FractionalIndex,
  ...overrides,
});

const legacyFrame = (
  overrides: Partial<NonDeleted<ExcalidrawFrameElement>> = {},
): NonDeleted<ExcalidrawFrameElement> => ({
  ...newFrameElement({ x: 0, y: 0, width: 200, height: 150, ...FRAME_STYLE }),
  id: "frame",
  seed: 1234,
  index: "a2" as FractionalIndex,
  ...overrides,
});

const child = (): NonDeletedExcalidrawElement => ({
  ...newElement({
    type: "rectangle",
    x: 20,
    y: 20,
    width: 50,
    height: 50,
    strokeColor: "#2f9e44",
    backgroundColor: "transparent",
    roughness: 0,
  }),
  id: "child",
  seed: 99,
  frameId: "frame",
  index: "a1" as FractionalIndex,
});

const exportSvg = (
  elements: NonDeletedExcalidrawElement[],
  theme: AppState["theme"] = THEME.LIGHT,
) =>
  exportScene({
    type: "svg",
    data: {
      elements,
      appState: { viewBackgroundColor: "#ffffff" },
      files: {},
    },
    config: {
      canvasBackgroundColor: false,
      theme,
      frameColor: HOST_FRAME_COLOR,
    },
  });

const nodesOf = (svg: SVGSVGElement, id: string) =>
  Array.from(svg.querySelectorAll(`[data-id="${id}"]`));

/** whether `a` comes before `b` in document order */
const precedes = (a: Element, b: Element) =>
  !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("frame SVG export", () => {
  it("uses the frame stroke width, not the frame fill colour, for legacy outlines", async () => {
    const magic = {
      ...newMagicFrameElement({
        x: 0,
        y: 0,
        width: 200,
        height: 150,
        ...FRAME_STYLE,
        customData: { frameColor: HOST_FRAME_COLOR },
      }),
      id: "magic",
      index: "a0" as FractionalIndex,
    };
    const svg = await exportSvg([magic]);
    const rect = svg.querySelector(`rect[data-id="magic"]`);
    expect(rect).not.toBeNull();
    expect(rect!.getAttribute("stroke-width")).toBe(
      `${FRAME_STYLE.strokeWidth}`,
    );
  });

  it("paints a shape frame's fill below its children and its outline above", async () => {
    const svg = await exportSvg([child(), shapeFrame()]);
    const frameNodes = nodesOf(svg, "frame");
    expect(frameNodes).toHaveLength(2);
    const [fillNode, strokeNode] = frameNodes;
    const childNode = nodesOf(svg, "child")[0];

    expect(
      fillNode.querySelector(`path[fill="${SHAPE_STYLE.backgroundColor}"]`),
    ).not.toBeNull();
    expect(
      fillNode.querySelector(`path[stroke="${SHAPE_STYLE.strokeColor}"]`),
    ).toBeNull();
    expect(
      strokeNode.querySelector(`path[stroke="${SHAPE_STYLE.strokeColor}"]`),
    ).not.toBeNull();
    expect(strokeNode.getAttribute("stroke-linecap")).toBe("round");
    expect(precedes(fillNode, childNode)).toBe(true);
    expect(precedes(childNode, strokeNode)).toBe(true);
    // no legacy outline rect
    expect(svg.querySelector(`rect[data-id="frame"]`)).toBeNull();
  });

  it("draws a childless shape frame in one node", async () => {
    const svg = await exportSvg([shapeFrame()]);
    const frameNodes = nodesOf(svg, "frame");
    expect(frameNodes).toHaveLength(1);
    expect(
      frameNodes[0].querySelector(
        `path[fill="${SHAPE_STYLE.backgroundColor}"]`,
      ),
    ).not.toBeNull();
    expect(
      frameNodes[0].querySelector(`path[stroke="${SHAPE_STYLE.strokeColor}"]`),
    ).not.toBeNull();
  });

  it("draws a legacy frame through the rough generator with the host palette and no fill", async () => {
    const svg = await exportSvg([legacyFrame({ backgroundColor: "#00ff00" })]);
    const frameNodes = nodesOf(svg, "frame");
    expect(frameNodes).toHaveLength(1);
    expect(frameNodes[0].tagName).toBe("g");
    expect(
      frameNodes[0].querySelector(`path[stroke="${HOST_FRAME_COLOR.stroke}"]`),
    ).not.toBeNull();
    expect(frameNodes[0].querySelector(`path[fill="#00ff00"]`)).toBeNull();
    expect(
      frameNodes[0].querySelector(
        `path[stroke-width="${FRAME_STYLE.strokeWidth}"]`,
      ),
    ).not.toBeNull();
  });

  it("prefers the frame's own customData.frameColor and applies dark mode", async () => {
    const svg = await exportSvg(
      [
        legacyFrame({
          customData: {
            frameColor: { ...HOST_FRAME_COLOR, stroke: "#abcdef" },
          },
        }),
      ],
      THEME.DARK,
    );
    expect(
      svg.querySelector(
        `[data-id="frame"] path[stroke="${applyDarkModeFilter(
          "#abcdef",
          true,
        )}"]`,
      ),
    ).not.toBeNull();
  });
});

const appState = (overrides: Partial<AppState> = {}): AppState =>
  ({
    ...getDefaultAppState(),
    selectedElementIds: {},
    editingTextElement: null,
    ...overrides,
  } as AppState);

const predicatesFor = (state: AppState, targets: ExcalidrawElement[]) => {
  const map = new Map(targets.map((el) => [el.id, el])) as any;
  const app = {
    scene: {
      getSelectedElements: () => targets,
      getNonDeletedElementsMap: () => map,
    },
  } as unknown as AppClassProperties;
  return getShapeActionPredicates(state, targets, map, app);
};

const STYLE_FLAGS = [
  "strokeColor",
  "backgroundColor",
  "strokeWidth",
  "strokeStyle",
  "sloppiness",
  "roundness",
] as const;

describe("frame style controls", () => {
  it("exposes the rectangle style controls for a selected regular frame", () => {
    const frame = legacyFrame({ backgroundColor: "#ffc9c9" });
    const predicates = predicatesFor(
      appState({ selectedElementIds: { [frame.id]: true } }),
      [frame],
    );
    for (const flag of STYLE_FLAGS) {
      expect([flag, predicates[flag]]).toEqual([flag, true]);
    }
    expect(predicates.fill).toBe(true);
  });

  it("exposes them for the frame tool, but not when it draws marker frames", () => {
    const frameTool = appState({
      activeTool: {
        ...getDefaultAppState().activeTool,
        type: "frame",
      } as AppState["activeTool"],
    });
    for (const flag of STYLE_FLAGS) {
      expect([flag, predicatesFor(frameTool, [])[flag]]).toEqual([flag, true]);
    }
    const markerTool = {
      ...frameTool,
      currentItemFrameRole: "marker" as const,
    };
    for (const flag of STYLE_FLAGS) {
      expect([flag, predicatesFor(markerTool, [])[flag]]).toEqual([
        flag,
        false,
      ]);
    }
  });

  it("does not expose them for marker frames or magic frames", () => {
    const marker = legacyFrame({ frameRole: "marker" });
    const magic = {
      ...newMagicFrameElement({ x: 0, y: 0, ...FRAME_STYLE }),
      id: "magic",
    };
    for (const target of [marker, magic]) {
      const predicates = predicatesFor(
        appState({ selectedElementIds: { [target.id]: true } }),
        [target],
      );
      for (const flag of STYLE_FLAGS) {
        expect([target.id, flag, predicates[flag]]).toEqual([
          target.id,
          flag,
          false,
        ]);
      }
    }
  });

  it("applies stroke colour, fill style and roundness picks to regular frames only", () => {
    const frame = legacyFrame();
    const marker = { ...legacyFrame({ frameRole: "marker" }), id: "marker" };
    const state = appState({
      selectedElementIds: { [frame.id]: true, [marker.id]: true },
    });
    const app = {
      editorInterface: { formFactor: "desktop" },
    } as unknown as AppClassProperties;
    const perform = (action: any, value: unknown) =>
      action.perform([frame, marker], state, value, app).elements as [
        ExcalidrawElement,
        ExcalidrawElement,
      ];

    const [stroked, strokedMarker] = perform(actionChangeStrokeColor, {
      color: "#e03131",
    });
    expect(stroked.strokeColor).toBe("#e03131");
    expect(stroked.customData?.frameStyle).toBe(FRAME_SHAPE_STYLE);
    expect(strokedMarker.strokeColor).toBe(marker.strokeColor);

    const [filled, filledMarker] = perform(actionChangeFillStyle, "zigzag");
    expect(filled.fillStyle).toBe("zigzag");
    expect(filledMarker.fillStyle).toBe(marker.fillStyle);

    const [rounded] = perform(actionChangeRoundness, "round");
    expect(rounded.roundness).toEqual({ type: ROUNDNESS.ADAPTIVE_RADIUS });
  });

  it("converts a legacy frame to a shape frame when a style property changes", () => {
    const frame = legacyFrame({ customData: { frameColor: HOST_FRAME_COLOR } });
    const marker = { ...legacyFrame({ frameRole: "marker" }), id: "marker" };
    const state = appState({
      selectedElementIds: { [frame.id]: true, [marker.id]: true },
    });
    const [nextFrame, nextMarker] = changeProperty(
      [frame, marker],
      state,
      (el) => ({ ...el, strokeWidth: 4 }),
    );
    expect(nextFrame.strokeWidth).toBe(4);
    expect(nextFrame.customData).toEqual({
      frameColor: HOST_FRAME_COLOR,
      frameStyle: FRAME_SHAPE_STYLE,
    });
    expect(nextMarker.customData?.frameStyle).toBeUndefined();

    // a non-style change leaves the frame legacy
    const [renamed] = changeProperty([frame], state, (el) => ({
      ...el,
      name: "Renamed",
    }));
    expect(renamed.customData?.frameStyle).toBeUndefined();
  });
});

describe("wrap selection in frame", () => {
  it("styles the new frame with the current-item styles", () => {
    const rect = child();
    const { frameId, ...free } = rect;
    const element = { ...free, frameId: null } as NonDeletedExcalidrawElement;
    const state = appState({
      currentItemStrokeColor: "#1971c2",
      currentItemBackgroundColor: "#ffc9c9",
      currentItemRoughness: 2,
      currentItemRoundness: "round",
      selectedElementIds: { [element.id]: true },
    });
    const map = new Map([[element.id, element]]) as any;
    const app = {
      scene: {
        getNonDeletedElementsMap: () => map,
        getElementsIncludingDeleted: () => [element],
      },
    } as unknown as AppClassProperties;
    const result = wrapInFrame([element], state, [element], app);
    if (!result) {
      throw new Error("wrapInFrame() returned no result");
    }
    const frame = (result.elements ?? []).find((el) => el.type === "frame")!;
    expect(frame.customData?.frameStyle).toBe(FRAME_SHAPE_STYLE);
    expect(frame.strokeColor).toBe("#1971c2");
    expect(frame.backgroundColor).toBe("#ffc9c9");
    expect(frame.roughness).toBe(2);
    expect(frame.roundness).toEqual({ type: ROUNDNESS.ADAPTIVE_RADIUS });
  });
});

describe("frame creation preview", () => {
  const makeCanvas = () =>
    Object.assign(document.createElement("canvas"), {
      width: 800,
      height: 600,
    });
  const strokeCalls = (canvas: HTMLCanvasElement) =>
    (
      canvas.getContext("2d") as unknown as {
        stroke: { mock: { calls: unknown[][] } };
      }
    ).stroke.mock.calls.length;

  // The editor passes its static canvas' RoughCanvas to the new-element
  // render: drawing through it would paint every intermediate frame size onto
  // the static canvas, which is not cleared while dragging (a trail of
  // outlines).
  it.each([
    ["shape", () => shapeFrame()],
    ["legacy", () => legacyFrame()],
  ])("paints a %s frame on the new-element canvas only", (_, makeFrame) => {
    const staticCanvas = makeCanvas();
    const newElementCanvas = makeCanvas();
    const frame = makeFrame();
    const map = new Map([[frame.id, frame]]);
    const state = {
      ...getDefaultAppState(),
      width: 800,
      height: 600,
      offsetLeft: 0,
      offsetTop: 0,
    } as AppState;
    renderNewElementScene({
      canvas: newElementCanvas,
      rc: new RoughCanvas(staticCanvas),
      newElement: frame,
      elementsMap: map as unknown as RenderableElementsMap,
      allElementsMap: map as unknown as NonDeletedSceneElementsMap,
      scale: 1,
      appState: state,
      renderConfig: {
        canvasBackgroundColor: "",
        scale: 1,
        imageCache: new Map(),
        renderGrid: false,
        renderLinks: false,
        isExporting: false,
        embedsValidationStatus: new Map(),
        elementsPendingErasure: new Set(),
        pendingFlowchartNodes: null,
        theme: state.theme,
      },
    });
    expect(strokeCalls(staticCanvas)).toBe(0);
    expect(strokeCalls(newElementCanvas)).toBeGreaterThan(0);
  });
});
