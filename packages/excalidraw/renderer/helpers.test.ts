import {
  COLOR_WHITE,
  OBSIDIAN_COMMON_HOST_PROTOCOL_VERSION,
  configureObsidianCommonHost,
  type ObsidianCommonHostAdapter,
  type ObsidianCommonHostDisposer,
} from "@excalidraw/common";
import { BLACKBOARD_BASE_COLOR } from "@excalidraw/element";

import {
  DEFAULT_SELECTION_COLOR,
  bootstrapCanvas,
  getSelectionColor,
} from "./helpers";

// KuszCanvas: the board shader needs WebGL2, which jsdom lacks
const { paintBoardShader } = vi.hoisted(() => ({
  paintBoardShader: vi.fn(
    (
      _context: CanvasRenderingContext2D,
      _view: { scrollX: number; scrollY: number; zoom: number },
      _width: number,
      _height: number,
    ) => true,
  ),
}));
vi.mock("./blackboardShaderCanvas", () => ({ paintBoardShader }));

const setup = () => {
  const canvas = document.createElement("canvas");
  canvas.width = 200;
  canvas.height = 100;
  const context = canvas.getContext("2d")!;
  const clearRect = vi.spyOn(context, "clearRect");
  const fillRect = vi.spyOn(context, "fillRect");
  return { canvas, context, clearRect, fillRect };
};

const run = (viewBackgroundColor: unknown) => {
  const { canvas, context, clearRect, fillRect } = setup();
  bootstrapCanvas({
    canvas,
    scale: 1,
    normalizedWidth: 200,
    normalizedHeight: 100,
    viewBackgroundColor: viewBackgroundColor as string,
  });
  return { context, clearRect, fillRect };
};

describe("bootstrapCanvas background painting", () => {
  it("skips clearRect for an opaque hex color (fill fully repaints)", () => {
    const { clearRect, fillRect } = run("#ffffff");
    expect(clearRect).not.toHaveBeenCalled();
    expect(fillRect).toHaveBeenCalledTimes(1);
  });

  it("skips clearRect for a 3-digit opaque hex color", () => {
    const { clearRect, fillRect } = run("#fff");
    expect(clearRect).not.toHaveBeenCalled();
    expect(fillRect).toHaveBeenCalledTimes(1);
  });

  it("clears for a hex color with alpha (#RGBA / #RRGGBBAA)", () => {
    expect(run("#ffff").clearRect).toHaveBeenCalledTimes(1);
    expect(run("#ffffff80").clearRect).toHaveBeenCalledTimes(1);
  });

  it("clears and skips fill for the transparent keyword", () => {
    const { clearRect, fillRect } = run("transparent");
    expect(clearRect).toHaveBeenCalledTimes(1);
    expect(fillRect).not.toHaveBeenCalled();
  });

  it("clears for rgba()/hsla() colors and still fills", () => {
    const rgba = run("rgba(255, 0, 0, 0.5)");
    expect(rgba.clearRect).toHaveBeenCalledTimes(1);
    expect(rgba.fillRect).toHaveBeenCalledTimes(1);
  });

  // the ghosting bug (#10931): a corrupted value must never leave the prior
  // frame on screen — we always clear when we can't prove the color is opaque
  it("clears for a corrupted color value to prevent ghosting", () => {
    expect(run("0000").clearRect).toHaveBeenCalledTimes(1);
    expect(run("asdfgh").clearRect).toHaveBeenCalledTimes(1);
  });

  it("falls back to white when the color is rejected by the canvas", () => {
    const { canvas, context } = setup();
    // simulate a stale fillStyle left over from a previous frame's drawing
    context.fillStyle = "#ff0000";
    let fillStyleAtFillTime = "";
    vi.spyOn(context, "fillRect").mockImplementation(() => {
      fillStyleAtFillTime = context.fillStyle as string;
    });

    bootstrapCanvas({
      canvas,
      scale: 1,
      normalizedWidth: 200,
      normalizedHeight: 100,
      viewBackgroundColor: "not-a-color",
    });

    // not the stale red — the seeded default
    expect(fillStyleAtFillTime).toBe(COLOR_WHITE);
  });

  it("clears for a non-string background", () => {
    const { clearRect, fillRect } = run(undefined);
    expect(clearRect).toHaveBeenCalledTimes(1);
    expect(fillRect).not.toHaveBeenCalled();
  });
});

// KuszCanvas START -- blackboard board: slate base and scene-anchored texture
describe("bootstrapCanvas in blackboard mode", () => {
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
  };

  beforeEach(() => {
    flags.blackboard = true;
    paintBoardShader.mockClear();
    dispose = configureObsidianCommonHost(host);
  });
  afterEach(() => {
    dispose?.();
    dispose = null;
  });

  const paint = (
    theme: "light" | "dark",
    viewBackgroundColor: string,
    view?: { scrollX: number; scrollY: number; zoom: number },
  ) => {
    const { canvas, context } = setup();
    const fills: unknown[] = [];
    vi.spyOn(context, "fillRect").mockImplementation(() => {
      fills.push(context.fillStyle);
    });
    bootstrapCanvas({
      canvas,
      scale: 1,
      normalizedWidth: 200,
      normalizedHeight: 100,
      theme,
      viewBackgroundColor,
      view,
    });
    return fills;
  };

  it("paints the base, then the shader board over the whole view", () => {
    const view = { scrollX: 3, scrollY: -4, zoom: 2 };
    const fills = paint("dark", "#ffffff", view);
    expect(fills.map((fill) => String(fill).toLowerCase())).toEqual([
      BLACKBOARD_BASE_COLOR,
    ]);
    expect(paintBoardShader).toHaveBeenCalledTimes(1);
    expect(paintBoardShader.mock.calls[0].slice(1)).toEqual([view, 200, 100]);
  });

  it("keeps the flat base where the shader cannot run", () => {
    paintBoardShader.mockReturnValueOnce(false);
    const fills = paint("dark", "#ffffff", { scrollX: 0, scrollY: 0, zoom: 1 });
    expect(fills.map((fill) => String(fill).toLowerCase())).toEqual([
      BLACKBOARD_BASE_COLOR,
    ]);
  });

  it("paints the base alone without a view", () => {
    const fills = paint("dark", "#ffffff");
    expect(fills.map((fill) => String(fill).toLowerCase())).toEqual([
      BLACKBOARD_BASE_COLOR,
    ]);
    expect(paintBoardShader).not.toHaveBeenCalled();
  });

  it("still clears for a transparent background", () => {
    expect(
      paint("dark", "transparent", { scrollX: 0, scrollY: 0, zoom: 1 }),
    ).toEqual([]);
    expect(paintBoardShader).not.toHaveBeenCalled();
  });

  it("leaves light theme and disabled mode alone", () => {
    expect(
      paint("light", "#ffffff", { scrollX: 0, scrollY: 0, zoom: 1 }).length,
    ).toBe(1);
    flags.blackboard = false;
    const fills = paint("dark", "#ffffff", { scrollX: 0, scrollY: 0, zoom: 1 });
    expect(fills.length).toBe(1);
    expect(String(fills[0]).toLowerCase()).not.toBe(BLACKBOARD_BASE_COLOR);
  });
});
// KuszCanvas END

// zsviczian START -- selection colors must resolve in the owning popout window
describe("getSelectionColor", () => {
  it("reads the computed style from the element's owning window", () => {
    const getComputedStyle = vi.fn(() => ({
      getPropertyValue: () => " #123456 ",
    }));
    const element = {
      ownerDocument: { defaultView: { getComputedStyle } },
    } as unknown as Element;

    expect(getSelectionColor(element)).toBe("#123456");
    expect(getComputedStyle).toHaveBeenCalledWith(element);
  });

  it("falls back when no owning window is available", () => {
    expect(getSelectionColor(null)).toBe(DEFAULT_SELECTION_COLOR);
  });
});
// zsviczian END
