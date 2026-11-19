/**
 * KuszCanvas web test harness host. TEST HARNESS STUB: NEVER USE IN PRODUCTION.
 *
 * The engine on this fork calls an Obsidian host for some editor features
 * (text and hyperlink editing attach Obsidian's inline link suggester, and
 * throw when no host is installed). Upstream excalidraw.com has no such
 * dependency. This module gives the harness a minimal host so those features
 * work in the browser.
 *
 * Every method returns the same value the engine falls back to when no host
 * is installed (see `packages/excalidraw/obsidianUtils.ts` and
 * `packages/common/src/commonObsidianUtils.ts`), so installing it changes
 * nothing except that host-only calls stop throwing. Obsidian-only features
 * (link suggestions, vault fonts, LaTeX/file/card/Lucide/SVG-import actions)
 * are not provided.
 *
 * The common host (render flags) is installed only when a flag is requested
 * by URL query, e.g. `?blackboard=1&markdown=1`, because installing it also
 * routes selection highlight colours through the host path.
 */

import {
  MAX_ZOOM,
  MIN_ZOOM,
  OBSIDIAN_COMMON_HOST_PROTOCOL_VERSION,
  ZOOM_STEP,
  configureObsidianCommonHost,
  type EditorInterface,
  type ObsidianCommonHostAdapter,
  type StylesPanelMode,
} from "@excalidraw/common";
import {
  OBSIDIAN_EXCALIDRAW_HOST_PROTOCOL_VERSION,
  configureObsidianExcalidrawHost,
  type ObsidianDiagramInsertion,
  type ObsidianExcalidrawHostAdapter,
  type ObsidianKeyBlocker,
  type ObsidianMermaidService,
} from "@excalidraw/excalidraw/obsidianExcalidrawHost";

/** Render flags the harness can switch on by URL query. */
export type HarnessHostFlags = Readonly<{
  blackboard: boolean;
  markdown: boolean;
}>;

const FLAG_QUERY_KEYS: Readonly<Record<keyof HarnessHostFlags, string>> = {
  blackboard: "blackboard",
  markdown: "markdown",
};

const parseFlagValue = (key: string, value: string | null): boolean => {
  if (value === null) {
    return false;
  }
  if (value === "1" || value === "true") {
    return true;
  }
  if (value === "0" || value === "false") {
    return false;
  }
  throw new Error(
    `Harness host: query "${key}=${value}" must be 1, 0, true or false`,
  );
};

/** Reads `?blackboard=` and `?markdown=` from a `location.search` string. */
export const parseHarnessHostFlags = (search: string): HarnessHostFlags => {
  if (typeof search !== "string") {
    throw new Error("Harness host: search must be a string");
  }
  const params = new URLSearchParams(search);
  return {
    blackboard: parseFlagValue(
      FLAG_QUERY_KEYS.blackboard,
      params.get(FLAG_QUERY_KEYS.blackboard),
    ),
    markdown: parseFlagValue(
      FLAG_QUERY_KEYS.markdown,
      params.get(FLAG_QUERY_KEYS.markdown),
    ),
  };
};

/** Key blocker for a suggester that never opens: never blocks keys. */
const createNoopKeyBlocker = (): ObsidianKeyBlocker => ({
  isBlockingKeys: () => false,
  close: () => {},
});

/**
 * Mermaid comes from the npm package the engine already depends on, loaded
 * lazily on first use (Obsidian supplies it from the Excalidraw Extras plugin).
 */
let mermaidService: ObsidianMermaidService | null = null;
const getHarnessMermaid = async (): Promise<ObsidianMermaidService> => {
  if (!mermaidService) {
    mermaidService = {
      loaded: true,
      api: import("@excalidraw/mermaid-to-excalidraw"),
    };
  }
  return mermaidService;
};

/** Excalidraw-layer host for the harness (protocol per the engine). */
export const createHarnessExcalidrawHost =
  (): ObsidianExcalidrawHostAdapter => ({
    protocolVersion: OBSIDIAN_EXCALIDRAW_HOST_PROTOCOL_VERSION,

    // engine no-host fallbacks (obsidianUtils.ts)
    isDoubleTapEraserEnabled: () => false,
    getZoomToFitMaxLevel: () => 1,
    isPenModeCrosshairVisible: () => true,
    isSingleFingerPanningEnabled: () => false,
    isDoubleClickTextEditingDisabled: () => false,
    getZoomStep: () => ZOOM_STEP,
    getZoomMin: () => MIN_ZOOM,
    getZoomMax: () => MAX_ZOOM,
    isContextMenuDisabled: () => false,
    shouldSyncElementLinkWithText: () => true,
    getLabel: (key: string) => key,

    // no vault: the engine then loads its bundled fonts
    loadFontFromFile: async (_filename: string) => undefined,

    getMermaid: getHarnessMermaid,

    // Obsidian-only pickers and imports: report, don't fail
    runAction: (action, _editorId) => {
      console.warn(
        `KuszCanvas test harness: "${action}" is an Obsidian-only action and is not available here`,
      );
    },

    // no conversion prompt: insert the diagram as generated
    prepareMermaidSVGInsert: async (
      _editorId: string,
      diagram: ObsidianDiagramInsertion,
    ) => diagram,

    // no vault to suggest links from
    attachInlineLinkSuggester: (
      _inputEl,
      _widthWrapper,
      _container,
      _suppressPlaceholder,
    ) => createNoopKeyBlocker(),
  });

/** Common-layer host for the harness: no-host defaults plus render flags. */
export const createHarnessCommonHost = (
  flags: HarnessHostFlags,
): ObsidianCommonHostAdapter => {
  if (
    !flags ||
    typeof flags.blackboard !== "boolean" ||
    typeof flags.markdown !== "boolean"
  ) {
    throw new Error(
      "Harness host: flags must have boolean blackboard and markdown",
    );
  }
  const { blackboard, markdown } = flags;
  return {
    protocolVersion: OBSIDIAN_COMMON_HOST_PROTOCOL_VERSION,
    // null = not running in Obsidian; the engine detects the browser itself
    getDeviceInfo: () => null,
    getDesktopUIMode: (): StylesPanelMode => "tray",
    getPreferredUIMode: (
      formFactor: EditorInterface["formFactor"],
    ): StylesPanelMode => (formFactor === "phone" ? "mobile" : "tray"),
    getCanvasLimits: () => ({ areaLimit: 16777216, widthHeightLimit: 32767 }),
    getHighlightColor: (_sceneBackgroundColor: string, opacity: number) =>
      `rgba(0,118,255,${opacity})`,
    isBlackboardModeEnabled: () => blackboard,
    isMarkdownTextRenderingEnabled: () => markdown,
  };
};

/**
 * Installs the harness hosts. Call once, before the editor mounts.
 * Returns a disposer that removes everything it installed.
 */
export const installHarnessHosts = (search: string): (() => void) => {
  const flags = parseHarnessHostFlags(search);
  const disposeExcalidrawHost = configureObsidianExcalidrawHost(
    createHarnessExcalidrawHost(),
  );
  const disposeCommonHost =
    flags.blackboard || flags.markdown
      ? configureObsidianCommonHost(createHarnessCommonHost(flags))
      : null;
  return () => {
    disposeCommonHost?.();
    disposeExcalidrawHost();
  };
};
