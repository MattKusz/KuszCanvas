/**
 * KuszCanvas: Markdown in the text editor.
 *
 * - `applyMarkdownShortcut`: Ctrl/Cmd + B, I and U toggle `**`, `*` and
 *   `<u>…</u>` around the selection.
 * - `createLiveTextPreview`: draws the edited text on a canvas under the
 *   textarea and hides the textarea's own glyphs (its caret and selection
 *   stay visible). Two triggers:
 *   - Markdown text rendering: the text renders as Markdown, raw on the
 *     lines holding the selection;
 *   - blackboard mode: chalk text renders as chalk while it is typed (plain
 *     or Markdown), with the element's grain so nothing shifts on commit.
 *
 * The shortcut is off unless the host enables Markdown text rendering.
 * Layout, edits and the paint decision are pure functions in
 * `@excalidraw/element`; this file only applies them to the DOM.
 */
import {
  KEYS,
  THEME,
  applyDarkModeFilter,
  getFontString,
  getVerticalOffset,
  isBlackboardModeEnabled,
  isMarkdownTextRenderingEnabled,
} from "@excalidraw/common";
import {
  alignWrappedLines,
  drawChalked,
  drawMarkdownText,
  drawPlainTextLines,
  getContainerElement,
  getLineHeightInPx,
  getLineWidth,
  getMarkdownOpChalkLayer,
  getMarkdownShortcutStyle,
  getSourceLineRange,
  isBlackboardRender,
  isChalkElement,
  isPaperRender,
  isTextElement,
  layoutMarkdownLivePreview,
  shouldPaintLiveTextPreview,
  toggleMarkdownStyle,
} from "@excalidraw/element";

import type { ChalkLayer } from "@excalidraw/element";

import type { ExcalidrawTextElement } from "@excalidraw/element/types";

import type App from "../components/App";

/** Set on the textarea while the preview draws its text. */
export const LIVE_TEXT_PREVIEW_CLASS = "excalidraw-wysiwyg--live-text-preview";

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

export type LiveTextPreview = Readonly<{
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
export const createLiveTextPreview = ({
  app,
  editable,
  elementId,
}: {
  app: App;
  editable: HTMLTextAreaElement;
  elementId: string;
}): LiveTextPreview => {
  if (!app || !editable || !editable.parentElement) {
    throw new Error(
      "createLiveTextPreview: app and an attached editable are required",
    );
  }
  if (typeof elementId !== "string" || !elementId) {
    throw new Error("createLiveTextPreview: elementId is required");
  }
  const ownerDocument = editable.ownerDocument;
  const ownerWindow = ownerDocument.defaultView ?? window;
  const canvas = ownerDocument.createElement("canvas");
  canvas.className = "excalidraw-wysiwyg-live-text-preview";
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
    editable.classList.toggle(LIVE_TEXT_PREVIEW_CLASS, active);
  };

  const paint = () => {
    const element = app.scene.getElement<ExcalidrawTextElement>(elementId);
    if (!element || !isTextElement(element)) {
      setActive(false);
      return;
    }
    const container = getContainerElement(
      element,
      app.scene.getNonDeletedElementsMap(),
    );
    const theme = app.state.theme;
    const blackboard = isBlackboardModeEnabled();
    const chalk =
      isBlackboardRender(theme, blackboard) &&
      isChalkElement(element, container);
    const value = editable.value;
    const font = getFontString(element);
    const markdownLayout = isMarkdownTextRenderingEnabled()
      ? layoutMarkdownLivePreview({
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
        })
      : null;
    const wrapMatches =
      element.text === value || alignWrappedLines(value, element.text) !== null;
    if (!shouldPaintLiveTextPreview({ markdownLayout, chalk, wrapMatches })) {
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
    // a sticky note's label is paper: light ink in blackboard mode
    const color = applyDarkModeFilter(
      element.strokeColor,
      theme === THEME.DARK &&
        !isPaperRender(element, container, theme, blackboard),
    );
    /** draws `layer` (everything without one); whether it painted */
    const draw = (target: CanvasRenderingContext2D, layer?: ChalkLayer) => {
      if (markdownLayout) {
        return drawMarkdownText(
          target,
          {
            layout: markdownLayout,
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
            color,
          },
          layer === undefined
            ? undefined
            : (op) => getMarkdownOpChalkLayer(op) === layer,
        );
      }
      // plain text is all stroke
      if (layer !== undefined && layer !== "stroke") {
        return false;
      }
      drawPlainTextLines(target, element, color, cssWidth);
      return true;
    };
    if (chalk) {
      // the element's seed at the scene scale: the same grain as on the
      // canvas once the edit ends
      drawChalked(context, {
        localBounds: null,
        seed: element.seed,
        jitter: false,
        environment: app.renderEnvironment,
        draw,
      });
    } else {
      draw(context);
    }
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
      editable.classList.remove(LIVE_TEXT_PREVIEW_CLASS);
      canvas.remove();
    },
  };
};
