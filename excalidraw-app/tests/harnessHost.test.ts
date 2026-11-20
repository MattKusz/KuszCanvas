import {
  MAX_ZOOM,
  MIN_ZOOM,
  OBSIDIAN_COMMON_HOST_PROTOCOL_VERSION,
  ZOOM_STEP,
  getObsidianCommonHost,
  isBlackboardModeEnabled,
  isMarkdownTextRenderingEnabled,
  type ObsidianCommonHostAdapter,
} from "@excalidraw/common";
import {
  OBSIDIAN_EXCALIDRAW_HOST_PROTOCOL_VERSION,
  getObsidianExcalidrawHost,
  type ObsidianExcalidrawHostAdapter,
} from "@excalidraw/excalidraw/obsidianExcalidrawHost";
import { attachInlineLinkSuggester } from "@excalidraw/excalidraw/obsidianUtils";

import {
  createHarnessCommonHost,
  createHarnessExcalidrawHost,
  getHarnessRenderFlags,
  installHarnessHosts,
  parseHarnessHostFlags,
  setHarnessRenderFlag,
} from "../harnessHost";

describe("parseHarnessHostFlags", () => {
  it("defaults both render flags to off", () => {
    expect(parseHarnessHostFlags("")).toEqual({
      blackboard: false,
      markdown: false,
    });
  });

  it("reads ?blackboard=1&markdown=1 (and true/false spellings)", () => {
    expect(parseHarnessHostFlags("?blackboard=1&markdown=true")).toEqual({
      blackboard: true,
      markdown: true,
    });
    expect(parseHarnessHostFlags("?blackboard=0&markdown=false")).toEqual({
      blackboard: false,
      markdown: false,
    });
  });

  it("ignores unrelated query parameters", () => {
    expect(parseHarnessHostFlags("?room=abc&markdown=1")).toEqual({
      blackboard: false,
      markdown: true,
    });
  });

  it("ignores the retired ?accent= query", () => {
    expect(parseHarnessHostFlags("?accent=e83e8c")).toEqual({
      blackboard: false,
      markdown: false,
    });
  });

  it("rejects an unrecognised flag value instead of guessing", () => {
    expect(() => parseHarnessHostFlags("?blackboard=yes")).toThrow(
      /blackboard/,
    );
  });

  it("rejects a non-string search", () => {
    expect(() => parseHarnessHostFlags(undefined as unknown as string)).toThrow(
      /search/,
    );
  });
});

describe("createHarnessExcalidrawHost", () => {
  const host: ObsidianExcalidrawHostAdapter = createHarnessExcalidrawHost();

  it("speaks the engine's Excalidraw host protocol", () => {
    expect(host.protocolVersion).toBe(
      OBSIDIAN_EXCALIDRAW_HOST_PROTOCOL_VERSION,
    );
  });

  it("returns a no-op key blocker from attachInlineLinkSuggester", () => {
    const textarea = document.createElement("textarea");
    const blocker = host.attachInlineLinkSuggester(textarea, undefined, null);
    expect(blocker.isBlockingKeys()).toBe(false);
    expect(() => blocker.close()).not.toThrow();
    expect(() => blocker.close()).not.toThrow();
  });

  it("matches the engine's no-host fallbacks", async () => {
    expect(host.isDoubleTapEraserEnabled()).toBe(false);
    expect(host.getZoomToFitMaxLevel()).toBe(1);
    expect(host.isPenModeCrosshairVisible()).toBe(true);
    expect(host.isSingleFingerPanningEnabled()).toBe(false);
    expect(host.isDoubleClickTextEditingDisabled()).toBe(false);
    expect(host.getZoomStep()).toBe(ZOOM_STEP);
    expect(host.getZoomMin()).toBe(MIN_ZOOM);
    expect(host.getZoomMax()).toBe(MAX_ZOOM);
    expect(host.isContextMenuDisabled()).toBe(false);
    expect(host.shouldSyncElementLinkWithText()).toBe(true);
    expect(host.getLabel("SOME_KEY")).toBe("SOME_KEY");
    await expect(host.loadFontFromFile("Virgil.woff2")).resolves.toBe(
      undefined,
    );
  });

  it("passes Mermaid SVG insertions through unchanged", async () => {
    const diagram = { elements: [], files: null };
    await expect(host.prepareMermaidSVGInsert("editor", diagram)).resolves.toBe(
      diagram,
    );
  });

  it("warns (does not throw) for Obsidian-only actions", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => host.runAction("LaTeX")).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/test harness.*LaTeX/),
    );
    warn.mockRestore();
  });
});

describe("createHarnessCommonHost", () => {
  it("speaks the common host protocol and mirrors the no-host defaults", () => {
    const host: ObsidianCommonHostAdapter = createHarnessCommonHost({
      blackboard: true,
      markdown: false,
    });
    expect(host.protocolVersion).toBe(OBSIDIAN_COMMON_HOST_PROTOCOL_VERSION);
    expect(host.getDeviceInfo()).toBeNull();
    expect(host.getDesktopUIMode()).toBe("tray");
    expect(host.getPreferredUIMode("phone")).toBe("mobile");
    expect(host.getPreferredUIMode("desktop")).toBe("tray");
    expect(host.getCanvasLimits()).toEqual({
      areaLimit: 16777216,
      widthHeightLimit: 32767,
    });
    expect(host.getHighlightColor("#fff", 0.5)).toBe("rgba(0,118,255,0.5)");
    expect(host.isBlackboardModeEnabled()).toBe(true);
    expect(host.isMarkdownTextRenderingEnabled()).toBe(false);
  });

  it("rejects missing flags", () => {
    expect(() =>
      createHarnessCommonHost({ blackboard: true } as unknown as {
        blackboard: boolean;
        markdown: boolean;
      }),
    ).toThrow(/markdown/);
  });
});

describe("installHarnessHosts", () => {
  it("installs the Excalidraw host so text editing's suggester no longer throws", () => {
    const dispose = installHarnessHosts("");
    try {
      expect(getObsidianExcalidrawHost()).not.toBeNull();
      // no render flag requested: the common host stays uninstalled
      expect(getObsidianCommonHost()).toBeNull();
      const textarea = document.createElement("textarea");
      const blocker = attachInlineLinkSuggester(textarea, undefined, null);
      expect(blocker.isBlockingKeys()).toBe(false);
    } finally {
      dispose();
    }
    expect(getObsidianExcalidrawHost()).toBeNull();
    expect(() =>
      attachInlineLinkSuggester(document.createElement("textarea")),
    ).toThrow(/not configured/);
  });

  it("installs the common host only when a render flag is requested", () => {
    const dispose = installHarnessHosts("?markdown=1");
    try {
      expect(getObsidianCommonHost()).not.toBeNull();
      expect(isMarkdownTextRenderingEnabled()).toBe(true);
      expect(isBlackboardModeEnabled()).toBe(false);
    } finally {
      dispose();
    }
    expect(getObsidianCommonHost()).toBeNull();
    expect(isMarkdownTextRenderingEnabled()).toBe(false);
  });
});

describe("setHarnessRenderFlag (main-menu toggles)", () => {
  it("installs the common host on demand and flips flags live", () => {
    const dispose = installHarnessHosts("");
    try {
      expect(getObsidianCommonHost()).toBeNull();
      setHarnessRenderFlag("blackboard", true);
      expect(getObsidianCommonHost()).not.toBeNull();
      expect(isBlackboardModeEnabled()).toBe(true);
      expect(getHarnessRenderFlags().blackboard).toBe(true);
      setHarnessRenderFlag("markdown", true);
      setHarnessRenderFlag("blackboard", false);
      expect(isBlackboardModeEnabled()).toBe(false);
      expect(isMarkdownTextRenderingEnabled()).toBe(true);
    } finally {
      dispose();
    }
    expect(getObsidianCommonHost()).toBeNull();
    expect(getHarnessRenderFlags()).toEqual({
      blackboard: false,
      markdown: false,
    });
  });

  it("starts from the URL flags", () => {
    const dispose = installHarnessHosts("?markdown=1");
    try {
      expect(getHarnessRenderFlags().markdown).toBe(true);
      setHarnessRenderFlag("markdown", false);
      expect(isMarkdownTextRenderingEnabled()).toBe(false);
    } finally {
      dispose();
    }
  });

  it("rejects an unknown flag or a non-boolean value", () => {
    expect(() => setHarnessRenderFlag("accent" as any, true)).toThrow();
    expect(() => setHarnessRenderFlag("blackboard", 1 as any)).toThrow();
  });
});
