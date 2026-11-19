/**
 * KuszCanvas: Markdown in the text editor.
 *
 * - `applyMarkdownShortcut`: Ctrl/Cmd + B, I and U toggle `**`, `*` and
 *   `<u>…</u>` around the selection.
 * - `createMarkdownLivePreview`: draws the edited text as Markdown on a
 *   canvas under the textarea, raw on the lines holding the selection, and
 *   hides the textarea's own glyphs (its caret and selection stay visible).
 *
 * Both are off unless the host enables Markdown text rendering. Layout and
 * edits are pure functions in `@excalidraw/element`; this file only applies
 * them to the DOM.
 */
import {
  KEYS,
  THEME,
  applyDarkModeFilter,
  getFontString,
  getMarkdownAccentColor,
  getVerticalOffset,
  isMarkdownTextRenderingEnabled,
} from "@excalidraw/common";
import {
  drawMarkdownText,
  getLineHeightInPx,
  getLineWidth,
  getMarkdownShortcutStyle,
  getSourceLineRange,
  isTextElement,
  layoutMarkdownLivePreview,
  toggleMarkdownStyle,
} from "@excalidraw/element";

import type { ExcalidrawTextElement } from "@excalidraw/element/types";

import type App from "../components/App";

/** Set on the textarea while the preview draws its text. */
export const MARKDOWN_PREVIEW_CLASS = "excalidraw-wysiwyg--markdown-preview";

/**
 * Handles a Markdown style shortcut. Returns `true` when it consumed the
 * event.
 */
export const applyMarkdownShortcut = (
  event: KeyboardEvent,
  editable: HTMLTextAreaElement,
): boolean => {
  if (!event || !editable) {
    throw new Error("applyMarkdownShortcut: event and editable are required");
  }
  if (event.isComposing || !isMarkdownTextRenderingEnabled()) {
    return false;
  }
  const style = getMarkdownShortcutStyle({
    key: event.key,
    code: event.code,
    ctrlOrCmd: event[KEYS.CTRL_OR_CMD],
    shiftKey: event.shiftKey,
    altKey: event.altKey,
  });
  if (!style) {
    return false;
  }
  // keep hosts (browser view-source, Obsidian hotkeys) off these keys
  event.preventDefault();
  event.stopPropagation();

  const edit = toggleMarkdownStyle(
    editable.value,
    editable.selectionStart,
    editable.selectionEnd,
    style,
  );
  if (edit.value !== editable.value) {
    // insertText keeps the edit on the textarea's native undo stack
    editable.setSelectionRange(edit.replaceStart, edit.replaceEnd);
    const inserted =
      typeof editable.ownerDocument.execCommand === "function" &&
      editable.ownerDocument.execCommand("insertText", false, edit.replacement);
    if (!inserted || editable.value !== edit.value) {
      editable.value = edit.value;
      editable.dispatchEvent(new Event("input"));
    }
  }
  editable.setSelectionRange(edit.selectionStart, edit.selectionEnd);
  return true;
};

export type MarkdownLivePreview = Readonly<{
  /** schedules a repaint (after an edit, a selection change or a restyle) */
  update: () => void;
  destroy: () => void;
}>;

/** Copied from the textarea so the preview sits exactly under its text. */
const MIRRORED_STYLES = [
  "left",
  "top",
  "width",
  "height",
  "transform",
  "transformOrigin",
  "opacity",
] as const;

/**
 * Creates the live preview for the textarea `editable` (already in the DOM)
 * editing the text element `elementId`.
 */
export const createMarkdownLivePreview = ({
  app,
  editable,
  elementId,
}: {
  app: App;
  editable: HTMLTextAreaElement;
  elementId: string;
}): MarkdownLivePreview => {
  if (!app || !editable || !editable.parentElement) {
    throw new Error(
      "createMarkdownLivePreview: app and an attached editable are required",
    );
  }
  if (typeof elementId !== "string" || !elementId) {
    throw new Error("createMarkdownLivePreview: elementId is required");
  }
  const ownerDocument = editable.ownerDocument;
  const ownerWindow = ownerDocument.defaultView ?? window;
  const canvas = ownerDocument.createElement("canvas");
  canvas.className = "excalidraw-wysiwyg-markdown-preview";
  Object.assign(canvas.style, {
    position: "absolute",
    display: "none",
    margin: 0,
    padding: 0,
    border: 0,
    pointerEvents: "none",
    zIndex: "var(--zIndex-wysiwyg)",
  });
  editable.parentElement.insertBefore(canvas, editable);

  let isActive = false;
  const setActive = (active: boolean) => {
    if (active === isActive) {
      return;
    }
    isActive = active;
    canvas.style.display = active ? "block" : "none";
    editable.classList.toggle(MARKDOWN_PREVIEW_CLASS, active);
  };

  const paint = () => {
    const element = app.scene.getElement<ExcalidrawTextElement>(elementId);
    if (
      !element ||
      !isTextElement(element) ||
      !isMarkdownTextRenderingEnabled()
    ) {
      setActive(false);
      return;
    }
    const value = editable.value;
    const font = getFontString(element);
    const layout = layoutMarkdownLivePreview({
      visualText: element.text,
      sourceText: value,
      font,
      measure: (text, runFont) =>
        getLineWidth(text, runFont, app.renderEnvironment),
      revealed: getSourceLineRange(
        value,
        Math.min(editable.selectionStart, value.length),
        Math.min(editable.selectionEnd, value.length),
      ),
    });
    if (!layout) {
      setActive(false);
      return;
    }

    for (const name of MIRRORED_STYLES) {
      canvas.style[name] = editable.style[name];
    }
    const cssWidth = parseFloat(editable.style.width);
    const cssHeight = parseFloat(editable.style.height);
    if (!(cssWidth > 0) || !(cssHeight > 0)) {
      setActive(false);
      return;
    }
    // the transform scales the box by the zoom: draw at that resolution
    const scale = app.state.zoom.value * (ownerWindow.devicePixelRatio || 1);
    canvas.width = Math.ceil(cssWidth * scale);
    canvas.height = Math.ceil(cssHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) {
      setActive(false);
      return;
    }
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, cssWidth, cssHeight);
    const lineHeightPx = getLineHeightInPx(
      element.fontSize,
      element.lineHeight,
    );
    drawMarkdownText(context, {
      layout,
      font,
      // the textarea aligns its lines within its own width
      width: cssWidth,
      textAlign: element.textAlign,
      fontSize: element.fontSize,
      lineHeightPx,
      verticalOffset: getVerticalOffset(
        element.fontFamily,
        element.fontSize,
        lineHeightPx,
      ),
      color: applyDarkModeFilter(
        element.strokeColor,
        app.state.theme === THEME.DARK,
      ),
      accentColor: getMarkdownAccentColor(),
    });
    setActive(true);
  };

  let frame: number | null = null;
  const update = () => {
    if (frame === null) {
      frame = ownerWindow.requestAnimationFrame(() => {
        frame = null;
        paint();
      });
    }
  };
  const onSelectionChange = () => {
    if (ownerDocument.activeElement === editable) {
      update();
    }
  };
  ownerDocument.addEventListener("selectionchange", onSelectionChange);
  editable.addEventListener("keyup", update);
  editable.addEventListener("pointerup", update);
  editable.addEventListener("select", update);
  update();

  return {
    update,
    destroy: () => {
      if (frame !== null) {
        ownerWindow.cancelAnimationFrame(frame);
        frame = null;
      }
      ownerDocument.removeEventListener("selectionchange", onSelectionChange);
      editable.removeEventListener("keyup", update);
      editable.removeEventListener("pointerup", update);
      editable.removeEventListener("select", update);
      editable.classList.remove(MARKDOWN_PREVIEW_CLASS);
      canvas.remove();
    },
  };
};
