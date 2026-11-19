/** KuszCanvas CP5: live frame expand controller, driven by a fake clock. */
import {
  FRAME_AUTO_EXPAND_PADDING,
  FRAME_EXPAND_ANIMATION_MS,
  FRAME_EXPAND_DWELL_MS,
  FRAME_FREEDRAW_ANIMATION_MS,
  Scene,
  syncInvalidIndices,
} from "@excalidraw/element";

import type {
  ExcalidrawFrameLikeElement,
  ExcalidrawFreeDrawElement,
  NonDeleted,
} from "@excalidraw/element/types";

import { API } from "../tests/helpers/api";

import { AppFrameLiveExpand } from "./App.frameLiveExpand";

import type { FrameLiveExpandScheduler } from "./App.frameLiveExpand";

const PAD = FRAME_AUTO_EXPAND_PADDING;
/** a full animation, with room for the 16 ms frame quantum */
const ANIM = FRAME_EXPAND_ANIMATION_MS + 48;
/** dwell plus a full animation */
const GROWN = FRAME_EXPAND_DWELL_MS + ANIM;

/** setTimeout / requestAnimationFrame on a manual clock */
const createFakeScheduler = () => {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const frames = new Map<number, (time: number) => void>();
  const scheduler: FrameLiveExpandScheduler = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id);
    },
    requestAnimationFrame: (fn) => {
      const id = nextId++;
      frames.set(id, fn);
      return id;
    },
    cancelAnimationFrame: (id) => {
      frames.delete(id);
    },
  };
  /** advances the clock in 16 ms frames, firing due timers and frames */
  const advance = (ms: number) => {
    const end = now + ms;
    while (now < end) {
      now = Math.min(end, now + 16);
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.fn();
        }
      }
      const due = [...frames];
      frames.clear();
      due.forEach(([, fn]) => fn(now));
    }
  };
  return {
    scheduler,
    advance,
    pending: () => ({ timers: timers.size, frames: frames.size }),
  };
};

const ORIGINAL = { x: 0, y: 0, width: 400, height: 200 };

/** frame 400 x 200 at the origin; a 100 x 100 note dragged by its centre */
const setup = (noteFrameId: string | null = null) => {
  const frame = API.createElement({
    id: "frame",
    type: "frame",
    x: 0,
    y: 0,
    width: 400,
    height: 200,
  });
  const note = API.createElement({
    id: "note",
    type: "rectangle",
    x: noteFrameId ? 150 : 600,
    y: 50,
    width: 100,
    height: 100,
    frameId: noteFrameId,
  });
  const scene = new Scene(syncInvalidIndices([note, frame]));
  const clock = createFakeScheduler();
  const previews: (string | null)[] = [];
  const live = new AppFrameLiveExpand({
    getScene: () => scene,
    getScheduler: () => clock.scheduler,
    onPreviewFrameChange: (frame) => previews.push(frame?.id ?? null),
  });
  const getFrame = () =>
    scene.getElement("frame") as NonDeleted<ExcalidrawFrameLikeElement>;
  const getNote = () => scene.getElement("note")!;
  /** moves the note's centre (and the pointer) to (x, y), as a drag does */
  const dragTo = (x: number, y: number) => {
    scene.mutateElement(getNote(), { x: x - 50, y: y - 50 });
    const frame = getFrame();
    const cursorFrame =
      x >= frame.x &&
      x <= frame.x + frame.width &&
      y >= frame.y &&
      y <= frame.y + frame.height
        ? frame
        : null;
    return live.dragMove({ x, y }, cursorFrame, [getNote()]);
  };
  const box = () => {
    const { x, y, width, height } = getFrame();
    return { x, y, width, height };
  };
  return { scene, clock, live, getFrame, getNote, dragTo, box, previews };
};

describe("AppFrameLiveExpand: a newcomer dragged in", () => {
  it("waits for the dwell, then animates, eased, to fit plus padding", () => {
    const { clock, dragTo, box } = setup();
    // centre inside near the right edge: the note reaches x 430
    expect(dragTo(380, 100)).toBeNull();
    clock.advance(FRAME_EXPAND_DWELL_MS - 20);
    expect(box()).toEqual(ORIGINAL);
    clock.advance(20 + FRAME_EXPAND_ANIMATION_MS / 3);
    expect(box().width).toBeGreaterThan(400);
    expect(box().width).toBeLessThan(430 + PAD);
    clock.advance(ANIM);
    expect(box()).toEqual({ x: 0, y: 0, width: 430 + PAD, height: 200 });
  });

  it("announces the frame as the target when the dwell passes, without a move", () => {
    const { clock, dragTo, previews } = setup();
    dragTo(380, 100);
    expect(previews).toEqual([]);
    clock.advance(FRAME_EXPAND_DWELL_MS + 20);
    expect(previews).toEqual(["frame"]);
  });

  it("is highlighted as the target only once the dwell has passed", () => {
    const { clock, dragTo } = setup();
    expect(dragTo(380, 100)).toBeNull();
    clock.advance(GROWN);
    expect(dragTo(385, 100)?.id).toBe("frame");
  });

  it("a quick drop lands on top: frame unchanged, no join", () => {
    const { clock, dragTo, box, live } = setup();
    dragTo(380, 100);
    clock.advance(FRAME_EXPAND_DWELL_MS - 50);
    expect(live.settle()).toEqual({
      frameId: "frame",
      joins: false,
      admitsNewMembers: false,
      outsidersOnTop: true,
    });
    expect(box()).toEqual(ORIGINAL);
  });

  it("a drop after the dwell joins and keeps the previewed fit", () => {
    const { clock, dragTo, box, live } = setup();
    dragTo(380, 100);
    clock.advance(FRAME_EXPAND_DWELL_MS + 30); // mid-animation
    expect(live.settle()).toEqual({
      frameId: "frame",
      joins: true,
      admitsNewMembers: true,
      outsidersOnTop: false,
    });
    expect(box()).toEqual({ x: 0, y: 0, width: 430 + PAD, height: 200 });
    expect(live.consumeDecision()?.joins).toBe(true);
    expect(live.consumeDecision()).toBeNull();
  });

  it("keeps following while the selection's centre stays in the original box", () => {
    const { clock, dragTo, box } = setup();
    dragTo(380, 100);
    clock.advance(GROWN);
    expect(dragTo(400, 200)?.id).toBe("frame"); // centre on the corner
    clock.advance(ANIM);
    expect(box()).toEqual({
      x: 0,
      y: 0,
      width: 450 + PAD,
      height: 250 + PAD,
    });
  });

  it("lets go once the selection overhangs by more than half its size", () => {
    const { clock, dragTo, box, live } = setup();
    dragTo(380, 100);
    clock.advance(GROWN);
    expect(dragTo(401, 100)).toBeNull(); // centre just past the right edge
    clock.advance(ANIM);
    expect(box()).toEqual(ORIGINAL);
    expect(live.settle()).toEqual({
      frameId: "frame",
      joins: false,
      admitsNewMembers: false,
      outsidersOnTop: false,
    });
    expect(box()).toEqual(ORIGINAL);
  });

  it("measures the zone against the original box, not the grown one", () => {
    const { clock, dragTo, box } = setup();
    dragTo(380, 100);
    clock.advance(GROWN);
    dragTo(399, 100);
    clock.advance(ANIM);
    expect(box().width).toBe(449 + PAD);
    // inside the grown frame, past the original's zone
    expect(dragTo(420, 100)).toBeNull();
  });

  it("re-engages, with a new dwell, after coming back", () => {
    const { clock, dragTo, box } = setup();
    dragTo(380, 100);
    clock.advance(GROWN);
    dragTo(600, 100);
    clock.advance(ANIM);
    expect(box()).toEqual(ORIGINAL);
    expect(dragTo(380, 100)).toBeNull();
    clock.advance(GROWN);
    expect(box().width).toBe(430 + PAD);
  });

  it("never shrinks below the original and never moves the element", () => {
    const { clock, dragTo, box, getNote } = setup();
    dragTo(200, 100);
    clock.advance(GROWN);
    expect(box()).toEqual(ORIGINAL);
    expect(getNote().x).toBe(150);
  });

  it("leaves no timers or animation frames after settle", () => {
    const { clock, dragTo, live } = setup();
    dragTo(380, 100);
    clock.advance(FRAME_EXPAND_DWELL_MS + 20);
    live.settle();
    expect(clock.pending()).toEqual({ timers: 0, frames: 0 });
  });

  it("cancel restores the original at once and stops this gesture", () => {
    const { clock, dragTo, box, live } = setup();
    dragTo(380, 100);
    clock.advance(GROWN);
    live.cancel(true);
    expect(box()).toEqual(ORIGINAL);
    expect(clock.pending()).toEqual({ timers: 0, frames: 0 });
    dragTo(381, 100);
    clock.advance(GROWN);
    expect(box()).toEqual(ORIGINAL);
    expect(live.settle()).toBeNull();
    // the next gesture is live again
    dragTo(380, 100);
    clock.advance(GROWN);
    expect(box().width).toBe(430 + PAD);
  });

  it("excludes locked and marker frames", () => {
    for (const patch of [{ locked: true }, { frameRole: "marker" }]) {
      const { clock, dragTo, box, scene, getFrame } = setup();
      scene.mutateElement(getFrame(), patch as any);
      dragTo(380, 100);
      clock.advance(GROWN);
      expect(box()).toEqual(ORIGINAL);
    }
  });

  it("does not bump versions while nothing changes", () => {
    const { clock, dragTo, getFrame } = setup();
    const v0 = getFrame().version;
    dragTo(200, 100);
    clock.advance(1000);
    expect(getFrame().version).toBe(v0);
  });

  it("validates its inputs", () => {
    const { live } = setup();
    expect(() => live.dragMove({ x: NaN, y: 0 }, null, [])).toThrow(/point/);
    expect(() => live.dragMove({ x: 0, y: 0 }, null, null as any)).toThrow(
      /elements/,
    );
    expect(
      () =>
        new AppFrameLiveExpand({
          getScene: null as any,
          getScheduler: () => createFakeScheduler().scheduler,
          onPreviewFrameChange: () => {},
        }),
    ).toThrow(/getScene/);
  });
});

describe("AppFrameLiveExpand: an existing child", () => {
  it("grows its frame at once, with no dwell", () => {
    const { clock, dragTo, box } = setup("frame");
    expect(dragTo(380, 100)?.id).toBe("frame");
    clock.advance(ANIM);
    expect(box()).toEqual({ x: 0, y: 0, width: 430 + PAD, height: 200 });
  });

  it("a quick drop keeps it in, fitted", () => {
    const { dragTo, box, live } = setup("frame");
    dragTo(380, 100);
    expect(live.settle()).toEqual({
      frameId: "frame",
      joins: true,
      admitsNewMembers: true,
      outsidersOnTop: false,
    });
    expect(box().width).toBe(430 + PAD);
  });

  it("past the zone the frame returns and the drop takes it out", () => {
    const { clock, dragTo, box, live } = setup("frame");
    dragTo(380, 100);
    clock.advance(ANIM);
    expect(dragTo(401, 100)).toBeNull();
    clock.advance(ANIM);
    expect(box()).toEqual(ORIGINAL);
    expect(live.settle()?.joins).toBe(false);
  });
});

describe("AppFrameLiveExpand: freehand", () => {
  const strokeSetup = (frameId: string | null) => {
    const ctx = setup();
    const stroke = API.createElement({
      id: "stroke",
      type: "freedraw",
      x: 350,
      y: 100,
      points: [
        [0, 0],
        [20, 0],
      ],
      frameId,
    } as any) as unknown as ExcalidrawFreeDrawElement;
    ctx.scene.insertElement(stroke);
    const extend = (dx: number, dy: number) => {
      const el = ctx.scene.getElement("stroke") as ExcalidrawFreeDrawElement;
      ctx.scene.mutateElement(el, {
        points: [...el.points, [dx, dy] as any],
      });
      ctx.live.freedrawMove(
        ctx.scene.getElement("stroke") as ExcalidrawFreeDrawElement,
      );
    };
    return { ...ctx, extend };
  };

  it("a stroke started in a frame grows it at once, keeping up", () => {
    const { clock, extend, box } = strokeSetup("frame");
    extend(150, 0); // reaches x 500
    clock.advance(FRAME_FREEDRAW_ANIMATION_MS + 32);
    expect(box().width).toBeGreaterThanOrEqual(500 + PAD - 1);
  });

  it("never contracts, however far the stroke goes", () => {
    const { clock, extend, box, live } = strokeSetup("frame");
    extend(900, 400);
    clock.advance(FRAME_FREEDRAW_ANIMATION_MS + 32);
    expect(box().width).toBeGreaterThan(1250);
    expect(box().height).toBeGreaterThan(500);
    expect(live.settle()?.joins).toBe(true);
    expect(box().width).toBeGreaterThan(1250);
  });

  it("a stroke started outside any frame grows nothing", () => {
    const { clock, extend, box, live } = strokeSetup(null);
    extend(150, 0);
    clock.advance(1000);
    expect(box()).toEqual(ORIGINAL);
    expect(live.settle()).toBeNull();
  });
});
