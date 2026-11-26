/**
 * KuszCanvas: a click on a rendered Markdown task checkbox toggles it.
 *
 * Armed on pointer down (the press doesn't select or drag the element),
 * committed on a pointer up over the same checkbox within the drag
 * threshold; a second pointer or a pointercancel disarms it. Only with the
 * selection or lasso tool, outside view mode and never on locked elements.
 * Hit-testing and the source rewrite are pure functions in
 * `@excalidraw/element` (`markdownTaskToggle.ts`).
 */
import {
  DRAGGING_THRESHOLD,
  EVENT,
  getFontString,
  getVerticalOffset,
  isMarkdownTextRenderingEnabled,
  viewportCoordsToSceneCoords,
} from "@excalidraw/common";
import { pointFrom, pointRotateRads, type Radians } from "@excalidraw/math";

import {
  findMarkdownCheckboxAt,
  getBoundTextElement,
  getContainerElement,
  getLineHeightInPx,
  getLineWidth,
  getMarkdownPaintOps,
  getMarkdownSourceLine,
  getStickyNoteLayout,
  isStickyNoteElement,
  isTextElement,
  layoutMarkdownText,
  refreshTextDimensions,
  toggleMarkdownTaskInTexts,
  updateBoundElements,
} from "@excalidraw/element";

import type { ExcalidrawTextElement } from "@excalidraw/element/types";

import type App from "./App";

/** extra hit area around a checkbox, in screen pixels */
const CHECKBOX_SLOP_PX = 4;

/** cheap pre-check before laying out the text */
const TASK_HINT = /\[[ xX]\]/;

type ScenePoint = Readonly<{ x: number; y: number }>;

type TaskHit = Readonly<{ elementId: string; sourceLine: number }>;

type Pending = TaskHit &
  Readonly<{
    pointerId: number;
    clientX: number;
    clientY: number;
    unsubscribe: () => void;
  }>;

const validatePoint = (point: ScenePoint, name: string) => {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error(`${name}: point must be finite`);
  }
};

export class AppMarkdownTasks {
  constructor(private app: App) {}

  private pending: Pending | null = null;

  /** The task checkbox under `scenePoint`, if a click there would toggle it. */
  hitTest = (scenePoint: ScenePoint): TaskHit | null => {
    validatePoint(scenePoint, "AppMarkdownTasks.hitTest");
    const { state } = this.app;
    if (
      !isMarkdownTextRenderingEnabled() ||
      state.viewModeEnabled ||
      state.editingTextElement ||
      (state.activeTool.type !== "selection" &&
        state.activeTool.type !== "lasso")
    ) {
      return null;
    }
    const hit = this.app.getElementAtPosition(scenePoint.x, scenePoint.y, {
      includeBoundTextElement: true,
    });
    if (!hit) {
      return null;
    }
    const elementsMap = this.app.scene.getNonDeletedElementsMap();
    const text = isTextElement(hit)
      ? hit
      : getBoundTextElement(hit, elementsMap);
    if (!text || !TASK_HINT.test(text.originalText)) {
      return null;
    }
    const visualLine = this.findCheckboxLine(text, scenePoint);
    if (visualLine === null) {
      return null;
    }
    const sourceLine = getMarkdownSourceLine(
      text.originalText,
      text.text,
      visualLine,
    );
    return sourceLine === null ? null : { elementId: text.id, sourceLine };
  };

  /** the visual line of the checkbox under `scenePoint` in `text` */
  private findCheckboxLine = (
    text: ExcalidrawTextElement,
    scenePoint: ScenePoint,
  ): number | null => {
    const font = getFontString(text);
    const { renderEnvironment } = this.app;
    // laid out exactly as the canvas renderer lays it out
    const layout = layoutMarkdownText(
      text.text,
      font,
      (line, lineFont) => getLineWidth(line, lineFont, renderEnvironment),
      text.originalText,
    );
    if (!layout) {
      return null;
    }
    const lineHeightPx = getLineHeightInPx(text.fontSize, text.lineHeight);
    const ops = getMarkdownPaintOps({
      layout,
      font,
      width: text.width,
      textAlign: text.textAlign,
      fontSize: text.fontSize,
      lineHeightPx,
      verticalOffset: getVerticalOffset(
        text.fontFamily,
        text.fontSize,
        lineHeightPx,
      ),
      color: text.strokeColor,
    });
    // into the element's unrotated frame, top-left at the origin
    const centre = pointFrom(text.x + text.width / 2, text.y + text.height / 2);
    const [x, y] = pointRotateRads(
      pointFrom(scenePoint.x, scenePoint.y),
      centre,
      -text.angle as Radians,
    );
    return findMarkdownCheckboxAt(
      ops,
      { x: x - text.x, y: y - text.y },
      CHECKBOX_SLOP_PX / this.app.state.zoom.value,
    );
  };

  /**
   * Arms a toggle when a plain primary press lands on a checkbox. Returns
   * `true` when it took the press (the caller stops: no selection or drag).
   */
  handlePointerDown = (
    event: Readonly<{
      pointerId: number;
      clientX: number;
      clientY: number;
      shiftKey: boolean;
      altKey: boolean;
      ctrlKey: boolean;
      metaKey: boolean;
    }>,
    scenePoint: ScenePoint,
  ): boolean => {
    if (!event) {
      throw new Error("AppMarkdownTasks.handlePointerDown: event is required");
    }
    validatePoint(scenePoint, "AppMarkdownTasks.handlePointerDown");
    this.cancel();
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
      return false;
    }
    const hit = this.hitTest(scenePoint);
    if (!hit) {
      return false;
    }
    const win = this.app.ownerWindow;
    const onPointerUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId === this.pending?.pointerId) {
        this.commit(upEvent);
      }
    };
    // a second finger (pinch/pan) or a browser takeover disarms the click
    const onAbort = () => this.cancel();
    win.addEventListener(EVENT.POINTER_UP, onPointerUp);
    win.addEventListener(EVENT.POINTER_CANCEL, onAbort);
    // added after this press has finished dispatching
    const timer = win.setTimeout(() =>
      win.addEventListener(EVENT.POINTER_DOWN, onAbort),
    );
    this.pending = {
      ...hit,
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      unsubscribe: () => {
        win.clearTimeout(timer);
        win.removeEventListener(EVENT.POINTER_UP, onPointerUp);
        win.removeEventListener(EVENT.POINTER_CANCEL, onAbort);
        win.removeEventListener(EVENT.POINTER_DOWN, onAbort);
      },
    };
    return true;
  };

  /** Disarms a pending toggle (context menu, pointercancel, new press). */
  cancel = () => {
    const pending = this.pending;
    this.pending = null;
    pending?.unsubscribe();
  };

  private commit = (upEvent: PointerEvent) => {
    const pending = this.pending;
    this.cancel();
    if (!pending) {
      return;
    }
    // the press never reached the shared pointer-up teardown
    this.app.setState({ cursorButton: "up" });
    this.app.savePointer(upEvent.clientX, upEvent.clientY, "up");

    const moved = Math.hypot(
      upEvent.clientX - pending.clientX,
      upEvent.clientY - pending.clientY,
    );
    if (moved > DRAGGING_THRESHOLD) {
      return;
    }
    const { x, y } = viewportCoordsToSceneCoords(upEvent, this.app.state);
    const hit = this.hitTest({ x, y });
    if (
      hit?.elementId !== pending.elementId ||
      hit.sourceLine !== pending.sourceLine
    ) {
      return;
    }
    this.toggle(hit);
  };

  /** Toggles the task in the element's text and raw source; one undo step. */
  private toggle = ({ elementId, sourceLine }: TaskHit) => {
    const { scene, renderEnvironment } = this.app;
    const text = scene.getNonDeletedElement(elementId);
    if (!text || !isTextElement(text)) {
      return;
    }
    const next = toggleMarkdownTaskInTexts(
      { originalText: text.originalText, rawText: text.rawText ?? "" },
      sourceLine,
    );
    if (!next) {
      // the host's raw source doesn't match: toggling would desync them
      return;
    }
    const elementsMap = scene.getNonDeletedElementsMap();
    const container = getContainerElement(text, elementsMap);
    if (container && isStickyNoteElement(container)) {
      // sticky notes: the fit owns both the label and the note geometry
      const layout = getStickyNoteLayout(container, text, {
        originalText: next.originalText,
        renderEnvironment,
      });
      scene.mutateElement(container, layout.container);
      scene.mutateElement(text, { ...next, ...layout.text });
      // arrows bound to the note follow its new geometry
      const latestContainer = scene.getNonDeletedElement(container.id);
      if (latestContainer) {
        updateBoundElements(latestContainer, scene, { renderEnvironment });
      }
    } else {
      const dimensions = refreshTextDimensions(
        text,
        container,
        elementsMap,
        next.originalText,
        undefined,
        renderEnvironment,
      );
      if (!dimensions) {
        return;
      }
      scene.mutateElement(text, { ...next, ...dimensions });
    }
    this.app.scheduleCapture();
  };
}
