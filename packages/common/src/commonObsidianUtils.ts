import { getObsidianCommonHost } from "./commonObsidianHost";

import type { EditorInterface, StylesPanelMode } from "./editorInterface";

export type { ObsidianDeviceType } from "./commonObsidianHost";

const normalizeStylesPanelMode = (mode: unknown): StylesPanelMode =>
  typeof mode === "string" &&
  ["tray", "full", "compact", "mobile"].includes(mode)
    ? (mode as StylesPanelMode)
    : "tray";

export const getObsidianDeviceInfo = () =>
  getObsidianCommonHost()?.getDeviceInfo() ?? null;

export const getDesktopUIMode = () => {
  return normalizeStylesPanelMode(getObsidianCommonHost()?.getDesktopUIMode());
};

export const getPreferredUIMode = (
  formFactor: EditorInterface["formFactor"],
): StylesPanelMode => {
  return (
    getObsidianCommonHost()?.getPreferredUIMode(formFactor) ??
    (formFactor === "phone" ? "mobile" : "tray")
  );
};

export function getAreaLimit() {
  return getObsidianCommonHost()?.getCanvasLimits().areaLimit ?? 16777216;
}

export function getWidthHeightLimit() {
  return getObsidianCommonHost()?.getCanvasLimits().widthHeightLimit ?? 32767;
}

/**
 * KuszCanvas: blackboard (chalk) rendering for dark theme. Outside Obsidian,
 * or when the host returns anything other than `true`, it is off.
 */
export const isBlackboardModeEnabled = (): boolean =>
  getObsidianCommonHost()?.isBlackboardModeEnabled() === true;

/**
 * KuszCanvas: inline Markdown rendering in text elements. Outside Obsidian,
 * or when the host returns anything other than `true`, it is off.
 */
export const isMarkdownTextRenderingEnabled = (): boolean =>
  getObsidianCommonHost()?.isMarkdownTextRenderingEnabled() === true;

/** KuszCanvas: tag colour when no host supplies an accent (Obsidian's default purple). */
export const DEFAULT_MARKDOWN_ACCENT_COLOR = "#8a5cf5";

/**
 * KuszCanvas: colour of Markdown tags in text elements. Uses the host's
 * accent colour; outside Obsidian, or for a blank/non-string value, the
 * default accent.
 */
export const getMarkdownAccentColor = (): string => {
  const color = getObsidianCommonHost()?.getAccentColor();
  return typeof color === "string" && color.trim() !== ""
    ? color.trim()
    : DEFAULT_MARKDOWN_ACCENT_COLOR;
};

export function getHighlightColor(
  sceneBgColor: string,
  opacity: number = 1,
): string {
  const fallbackColor = `rgba(0,118,255,${opacity})`;
  const host = getObsidianCommonHost();
  if (host) {
    return host.getHighlightColor(sceneBgColor, opacity) ?? fallbackColor;
  }
  return fallbackColor;
}
