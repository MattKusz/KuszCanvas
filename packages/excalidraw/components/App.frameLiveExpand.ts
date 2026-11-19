/**
 * KuszCanvas CP5: frames that grow while something is dragged (or drawn)
 * into them, before the pointer is released.
 *
 * - Newcomers (elements not in the frame at drag start): the frame waits
 *   FRAME_EXPAND_DWELL_MS, then animates (eased) to fit them plus padding and
 *   keeps following. Dropped before the dwell, they land on top of the frame.
 * - A frame's own children: it follows at once, with no dwell.
 * - Either way, once the dragged selection overhangs the frame's ORIGINAL box
 *   by more than FRAME_FOLLOW_ZONE_RATIO of its own size, the frame animates
 *   back and the drop does not join it.
 * - A freehand stroke started in a frame grows it at once and never lets go.
 *
 * On release `settle()` puts every frame where its preview was heading, so
 * the drop matches the preview and no mutation outlives the gesture (the
 * whole drag, expansion included, is the one undo step the release
 * captures). The rules are pure (`@excalidraw/element` frameLiveExpand); this
 * class owns only timers, animation frames and scene mutations. Timers come
 * from the window that owns the editor (popout-safe).
 */
import {
  easeOutCubic,
  FRAME_AUTO_EXPAND_PADDING,
  FRAME_EXPAND_ANIMATION_MS,
  FRAME_EXPAND_DWELL_MS,
  FRAME_FOLLOW_ZONE_RATIO,
  FRAME_FREEDRAW_ANIMATION_MS,
  frameBoxesEqual,
  frameDwellApplies,
  getElementsFitBounds,
  getFrameBox,
  getFrameDropDecision,
  growFrameBoxToFit,
  interpolateFrameBox,
  isFrameAutoExpandable,
  isFrameLikeElement,
  isPointInFrameBox,
  isSelectionInFrameFollowZone,
  isTextElement,
  unionBounds,
} from "@excalidraw/element";

import type {
  FrameBox,
  FrameDropDecision as FrameDropRule,
  Scene,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
  ExcalidrawFreeDrawElement,
  NonDeleted,
} from "@excalidraw/element/types";

/** The timing functions of the window that owns the editor. */
export type FrameLiveExpandScheduler = {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
  requestAnimationFrame: (fn: (time: number) => void) => number;
  cancelAnimationFrame: (id: number) => void;
};

/** What the release does with the frame the gesture previewed. */
export type FrameDropDecision = {
  frameId: ExcalidrawFrameLikeElement["id"];
  joins: boolean;
  admitsNewMembers: boolean;
  outsidersOnTop: boolean;
};

type Session = {
  frameId: ExcalidrawFrameLikeElement["id"];
  kind: "drag" | "freedraw";
  original: FrameBox;
  dwellElapsed: boolean;
  dwellTimer: number | null;
  inZone: boolean;
  hasMembers: boolean;
  hasOutsiders: boolean;
  /** the box fitting all dragged elements / only the frame's own children */
  fitAll: FrameBox;
  fitMembers: FrameBox;
};

type Animation = {
  from: FrameBox;
  to: FrameBox;
  start: number;
  duration: number;
};

/** the dragged elements that decide membership: a label follows its container */
const getMembershipElements = (dragged: readonly ExcalidrawElement[]) =>
  dragged.filter(
    (element) =>
      !(isTextElement(element) && element.containerId) &&
      !isFrameLikeElement(element),
  );

export class AppFrameLiveExpand {
  private readonly getScene: () => Scene;
  private readonly getScheduler: () => FrameLiveExpandScheduler;
  private readonly onPreviewFrameChange: (
    frame: NonDeleted<ExcalidrawFrameLikeElement> | null,
  ) => void;

  /** each frame's box before this gesture first touched it */
  private originals = new Map<string, FrameBox>();
  private session: Session | null = null;
  private animations = new Map<string, Animation>();
  private animationFrame: {
    id: number;
    scheduler: FrameLiveExpandScheduler;
  } | null = null;
  /** Escape turned live expand off for the rest of this gesture */
  private cancelledForGesture = false;
  private decision: FrameDropDecision | null = null;
  /** a frame the drag let go of (or may not enter): the drop must not join */
  private rejectedFrameId: string | null = null;

  constructor(deps: {
    getScene: () => Scene;
    getScheduler: () => FrameLiveExpandScheduler;
    /** the drop target changed between pointer moves (the dwell passed) */
    onPreviewFrameChange: (
      frame: NonDeleted<ExcalidrawFrameLikeElement> | null,
    ) => void;
  }) {
    if (!deps || typeof deps.getScene !== "function") {
      throw new Error("AppFrameLiveExpand: getScene must be a function");
    }
    if (typeof deps.getScheduler !== "function") {
      throw new Error("AppFrameLiveExpand: getScheduler must be a function");
    }
    if (typeof deps.onPreviewFrameChange !== "function") {
      throw new Error(
        "AppFrameLiveExpand: onPreviewFrameChange must be a function",
      );
    }
    this.getScene = deps.getScene;
    this.getScheduler = deps.getScheduler;
    this.onPreviewFrameChange = deps.onPreviewFrameChange;
  }

  /**
   * A drag moved. `cursorFrame` is the frame the editor finds under the
   * pointer (live geometry); `dragged` are the dragged elements at their new
   * positions. Returns the frame the drop would join now — the one to
   * highlight — or null.
   */
  dragMove(
    pointer: { x: number; y: number },
    cursorFrame: NonDeleted<ExcalidrawFrameLikeElement> | null,
    dragged: readonly ExcalidrawElement[],
  ): NonDeleted<ExcalidrawFrameLikeElement> | null {
    if (
      !pointer ||
      !Number.isFinite(pointer.x) ||
      !Number.isFinite(pointer.y)
    ) {
      throw new Error("AppFrameLiveExpand.dragMove: expected a finite point");
    }
    if (!Array.isArray(dragged)) {
      throw new Error("AppFrameLiveExpand.dragMove: expected dragged elements");
    }
    if (this.cancelledForGesture) {
      return cursorFrame;
    }

    const elementsMap = this.getScene().getNonDeletedElementsMap();
    const members = getMembershipElements(dragged);
    const allBounds = getElementsFitBounds(dragged, elementsMap);
    const selection = unionBounds(allBounds);
    if (!selection || !members.length) {
      return cursorFrame;
    }
    const inZoneOf = (frame: ExcalidrawFrameLikeElement) =>
      isSelectionInFrameFollowZone(
        selection,
        this.getOriginal(frame),
        FRAME_FOLLOW_ZONE_RATIO,
      );
    const getFrame = (id: string | null) => {
      const frame = id ? elementsMap.get(id) : null;
      return frame && isFrameLikeElement(frame) ? frame : null;
    };

    // the live session keeps its frame while the selection stays in its zone
    let session = this.session;
    if (session) {
      const frame = getFrame(session.frameId);
      if (!frame || !inZoneOf(frame)) {
        this.endSession();
        session = null;
      }
    }

    if (!session) {
      // the dragged elements' own frame (all children of one frame), else
      // the frame under the pointer, entered from inside its original box
      const ownFrameId = members.every(
        (element) => element.frameId && element.frameId === members[0].frameId,
      )
        ? members[0].frameId
        : null;
      const ownFrame = getFrame(ownFrameId);
      const candidate =
        ownFrame && isFrameAutoExpandable(ownFrame) && inZoneOf(ownFrame)
          ? ownFrame
          : cursorFrame &&
            cursorFrame.id !== ownFrameId &&
            isFrameAutoExpandable(cursorFrame) &&
            isPointInFrameBox(pointer, this.getOriginal(cursorFrame)) &&
            inZoneOf(cursorFrame)
          ? cursorFrame
          : null;
      if (candidate) {
        session = this.startSession(candidate, "drag", members);
      }
    }

    if (!session) {
      if (cursorFrame && isFrameAutoExpandable(cursorFrame)) {
        // under the pointer, but not engaged: the drop must not join it
        this.rejectedFrameId = cursorFrame.id;
        return null;
      }
      return cursorFrame;
    }

    session.inZone = true;
    session.hasMembers = members.some((e) => e.frameId === session!.frameId);
    session.hasOutsiders = members.some((e) => e.frameId !== session!.frameId);
    session.fitAll = growFrameBoxToFit(
      session.original,
      allBounds,
      FRAME_AUTO_EXPAND_PADDING,
    );
    session.fitMembers = growFrameBoxToFit(
      session.original,
      getElementsFitBounds(
        dragged.filter((e) => e.frameId === session!.frameId),
        elementsMap,
      ),
      FRAME_AUTO_EXPAND_PADDING,
    );

    const rule = this.applyPreview(session);
    return rule.joins ? getFrame(session.frameId) : null;
  }

  /**
   * A freehand stroke grew. A stroke belongs to the frame it started in (if
   * any): that frame grows to fit it at once and never lets go. A stroke
   * started outside grows nothing.
   */
  freedrawMove(element: ExcalidrawFreeDrawElement) {
    if (!element || element.type !== "freedraw") {
      throw new Error("AppFrameLiveExpand.freedrawMove: expected a freedraw");
    }
    if (this.cancelledForGesture || !element.frameId) {
      return;
    }
    const elementsMap = this.getScene().getNonDeletedElementsMap();
    let session = this.session;
    if (!session || session.frameId !== element.frameId) {
      if (session) {
        this.endSession();
      }
      const frame = elementsMap.get(element.frameId);
      if (
        !frame ||
        !isFrameLikeElement(frame) ||
        !isFrameAutoExpandable(frame)
      ) {
        return;
      }
      session = this.startSession(frame, "freedraw", [element]);
    }
    session.fitAll = growFrameBoxToFit(
      session.original,
      getElementsFitBounds([element], elementsMap),
      FRAME_AUTO_EXPAND_PADDING,
    );
    this.applyPreview(session);
  }

  /**
   * The gesture ended: stop every timer and animation, put each frame where
   * its preview was heading, and remember the decision for the drop.
   */
  settle(): FrameDropDecision | null {
    const session = this.session;
    let decision: FrameDropDecision | null = null;

    this.stopTimers();
    if (session) {
      const rule = this.getRule(session);
      this.animations.delete(session.frameId);
      this.setFrameBox(session.frameId, this.getPreviewBox(session, rule));
      decision = {
        frameId: session.frameId,
        joins: rule.joins,
        admitsNewMembers: rule.admitsNewMembers,
        outsidersOnTop: rule.outsidersOnTop,
      };
    } else if (this.rejectedFrameId) {
      decision = {
        frameId: this.rejectedFrameId,
        joins: false,
        admitsNewMembers: false,
        outsidersOnTop: false,
      };
    }
    for (const [frameId, animation] of this.animations) {
      this.setFrameBox(frameId, animation.to);
    }
    this.reset();
    this.cancelledForGesture = false;
    this.decision = decision;
    return decision;
  }

  /** The last `settle()` decision, once (null after it was read). */
  consumeDecision(): FrameDropDecision | null {
    const decision = this.decision;
    this.decision = null;
    return decision;
  }

  /**
   * Puts every touched frame back to its original box at once and stops all
   * timers. `forRestOfGesture`: Escape keeps live expand off until release;
   * a tool change or unmount does not.
   */
  cancel(forRestOfGesture: boolean) {
    if (typeof forRestOfGesture !== "boolean") {
      throw new Error("AppFrameLiveExpand.cancel: expected a boolean");
    }
    const wasActive = this.isActive();
    this.stopTimers();
    for (const [frameId, original] of this.originals) {
      this.setFrameBox(frameId, original);
    }
    this.reset();
    this.decision = null;
    if (forRestOfGesture && wasActive) {
      this.cancelledForGesture = true;
    }
  }

  isActive() {
    return (
      !!this.session || this.animations.size > 0 || this.originals.size > 0
    );
  }

  // ---------------------------------------------------------------------------

  private getOriginal(frame: ExcalidrawFrameLikeElement): FrameBox {
    let original = this.originals.get(frame.id);
    if (!original) {
      original = getFrameBox(frame);
      this.originals.set(frame.id, original);
    }
    return original;
  }

  private startSession(
    frame: ExcalidrawFrameLikeElement,
    kind: Session["kind"],
    members: readonly ExcalidrawElement[],
  ): Session {
    const original = this.getOriginal(frame);
    const hasOutsiders = members.some((e) => e.frameId !== frame.id);
    const session: Session = {
      frameId: frame.id,
      kind,
      original,
      // only newcomers dragged in wait; children and strokes do not
      dwellElapsed: kind === "freedraw" || !frameDwellApplies({ hasOutsiders }),
      dwellTimer: null,
      inZone: true,
      hasMembers: members.some((e) => e.frameId === frame.id),
      hasOutsiders,
      fitAll: original,
      fitMembers: original,
    };
    if (!session.dwellElapsed) {
      session.dwellTimer = this.getScheduler().setTimeout(() => {
        if (this.session !== session) {
          return;
        }
        session.dwellTimer = null;
        session.dwellElapsed = true;
        const rule = this.applyPreview(session);
        // the pointer may rest: the highlight (and the drop) must follow now
        const frame = this.getScene()
          .getNonDeletedElementsMap()
          .get(session.frameId);
        this.onPreviewFrameChange(
          rule.joins && frame && isFrameLikeElement(frame) ? frame : null,
        );
      }, FRAME_EXPAND_DWELL_MS);
    }
    if (this.rejectedFrameId === frame.id) {
      this.rejectedFrameId = null;
    }
    this.session = session;
    return session;
  }

  /** ends the live session; its frame returns to its original box */
  private endSession() {
    const session = this.session;
    if (!session) {
      return;
    }
    if (session.dwellTimer !== null) {
      this.getScheduler().clearTimeout(session.dwellTimer);
    }
    this.session = null;
    this.rejectedFrameId = session.frameId;
    this.animateTo(
      session.frameId,
      session.original,
      FRAME_EXPAND_ANIMATION_MS,
    );
  }

  private getRule(session: Session): FrameDropRule {
    return getFrameDropDecision({
      kind: session.kind,
      dwellElapsed: session.dwellElapsed,
      inZone: session.inZone,
      hasMembers: session.hasMembers,
      hasOutsiders: session.hasOutsiders,
    });
  }

  private getPreviewBox(session: Session, rule: FrameDropRule) {
    return rule.size === "all"
      ? session.fitAll
      : rule.size === "members"
      ? session.fitMembers
      : session.original;
  }

  /** animates the session's frame toward what a drop now would leave */
  private applyPreview(session: Session): FrameDropRule {
    const rule = this.getRule(session);
    this.animateTo(
      session.frameId,
      this.getPreviewBox(session, rule),
      session.kind === "freedraw"
        ? FRAME_FREEDRAW_ANIMATION_MS
        : FRAME_EXPAND_ANIMATION_MS,
    );
    return rule;
  }

  private animateTo(frameId: string, to: FrameBox, duration: number) {
    const frame = this.getScene().getNonDeletedElementsMap().get(frameId);
    if (!frame || !isFrameLikeElement(frame)) {
      this.animations.delete(frameId);
      return;
    }
    const current = getFrameBox(frame);
    const running = this.animations.get(frameId);
    if (
      running ? frameBoxesEqual(running.to, to) : frameBoxesEqual(current, to)
    ) {
      return;
    }
    this.animations.set(frameId, {
      from: current,
      to,
      start: this.getScheduler().now(),
      duration,
    });
    this.requestTick();
  }

  private requestTick() {
    if (this.animationFrame) {
      return;
    }
    const scheduler = this.getScheduler();
    this.animationFrame = {
      scheduler,
      id: scheduler.requestAnimationFrame(this.tick),
    };
  }

  private tick = () => {
    const scheduler = this.animationFrame?.scheduler ?? this.getScheduler();
    this.animationFrame = null;
    const now = scheduler.now();
    for (const [frameId, animation] of [...this.animations]) {
      const progress = Math.min(
        1,
        Math.max(0, (now - animation.start) / animation.duration),
      );
      this.setFrameBox(
        frameId,
        interpolateFrameBox(
          animation.from,
          animation.to,
          easeOutCubic(progress),
        ),
      );
      if (progress >= 1) {
        this.animations.delete(frameId);
      }
    }
    if (this.animations.size) {
      this.requestTick();
    }
  };

  private setFrameBox(frameId: string, box: FrameBox) {
    const scene = this.getScene();
    const frame = scene.getNonDeletedElementsMap().get(frameId);
    if (!frame || !isFrameLikeElement(frame)) {
      return;
    }
    if (frameBoxesEqual(getFrameBox(frame), box) && frame.width >= 0) {
      return;
    }
    // no capture is scheduled here: the change joins the gesture's undo step
    scene.mutateElement(frame, box, {
      informMutation: true,
      isDragging: false,
    });
  }

  private stopTimers() {
    if (this.session?.dwellTimer != null) {
      this.getScheduler().clearTimeout(this.session.dwellTimer);
      this.session.dwellTimer = null;
    }
    if (this.animationFrame) {
      this.animationFrame.scheduler.cancelAnimationFrame(
        this.animationFrame.id,
      );
      this.animationFrame = null;
    }
  }

  private reset() {
    this.session = null;
    this.rejectedFrameId = null;
    this.animations.clear();
    this.originals.clear();
  }
}
