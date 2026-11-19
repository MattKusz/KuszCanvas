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
 * by URL query, e.g. `?blackboard=1&markdown=1&accent=e83e8c`, because
 * installing it also routes selection highlight colours through the host path.
 * `accent` stands in for Obsidian's accent colour (Markdown tag colour).
 */

import {
  DEFAULT_MARKDOWN_ACCENT_COLOR,
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

/** Render settings the harness can switch on by URL query. */
export type HarnessHostFlags = Readonly<{
  blackboard: boolean;
  markdown: boolean;
  /** CSS colour for Markdown tags; `null` = the engine default */
  accent: string | null;
}>;

const FLAG_QUERY_KEYS: Readonly<Record<keyof HarnessHostFlags, string>> = {
  blackboard: "blackboard",
  markdown: "markdown",
  accent: "accent",
};

const HEX_COLOR = /^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTION_COLOR = /^(rgb|rgba|hsl|hsla)\([0-9.,%\s/+-]+\)$/i;
const NAMED_COLOR = /^[a-z]+$/i;

/** `?accent=` value: hex (the `#` optional, as it needs URL escaping), rgb()/hsl() or a colour name. */
const parseAccentValue = (value: string | null): string | null => {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  const hex = HEX_COLOR.exec(trimmed);
  if (hex) {
    return `#${hex[1]}`;
  }
  if (FUNCTION_COLOR.test(trimmed) || NAMED_COLOR.test(trimmed)) {
    return trimmed;
  }
  throw new Error(
    `Harness host: query "accent=${value}" must be a hex, rgb(), hsl() or named colour`,
  );
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

/** Reads `?blackboard=`, `?markdown=` and `?accent=` from a `location.search` string. */
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
    accent: parseAccentValue(params.get(FLAG_QUERY_KEYS.accent)),
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
  if (
    flags.accent !== null &&
    (typeof flags.accent !== "string" || flags.accent.trim() === "")
  ) {
    throw new Error("Harness host: accent must be a colour string or null");
  }
  const { blackboard, markdown, accent } = flags;
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
    getAccentColor: () => accent ?? DEFAULT_MARKDOWN_ACCENT_COLOR,
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
    flags.blackboard || flags.markdown || flags.accent !== null
      ? configureObsidianCommonHost(createHarnessCommonHost(flags))
      : null;
  return () => {
    disposeCommonHost?.();
    disposeExcalidrawHost();
  };
};
