import { arrayToMap } from "@excalidraw/common";
import {
  newElement,
  newEmbeddableElement,
  newFrameElement,
  newImageElement,
  newStickyNoteElement,
  newTextElement,
} from "@excalidraw/element";
import { lineSegment, pointFrom } from "@excalidraw/math";

import type { GlobalPoint } from "@excalidraw/math";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { eraserTest } from "../eraser";

const BOX = { x: 0, y: 0, width: 200, height: 200 };

const segment = (x1: number, y1: number, x2: number, y2: number) =>
  lineSegment(pointFrom<GlobalPoint>(x1, y1), pointFrom<GlobalPoint>(x2, y2));

// fully inside the 200×200 box, far from every edge
const INSIDE = segment(80, 100, 120, 100);
// crosses the left edge
const ACROSS_EDGE = segment(-20, 100, 20, 100);

const hits = (
  element: ExcalidrawElement,
  pathSegment: ReturnType<typeof segment>,
  ...others: ExcalidrawElement[]
) => eraserTest(pathSegment, element, arrayToMap([element, ...others]), 1);

describe("eraserTest", () => {
  it("does not erase a filled shape through its fill", () => {
    for (const type of ["rectangle", "ellipse", "diamond"] as const) {
      const shape = newElement({
        type,
        ...BOX,
        backgroundColor: "#ffc9c9",
        fillStyle: "solid",
      });

      expect(hits(shape, INSIDE)).toBe(false);
    }
  });

  it("erases a filled shape where the eraser crosses its border", () => {
    const rect = newElement({
      type: "rectangle",
      ...BOX,
      backgroundColor: "#ffc9c9",
      fillStyle: "solid",
    });

    expect(hits(rect, ACROSS_EDGE)).toBe(true);
  });

  it("does not erase a shape through its label", () => {
    const rect = newElement({ type: "rectangle", ...BOX });
    const label = newTextElement({
      text: "label",
      containerId: rect.id,
      x: 60,
      y: 90,
      width: 80,
      height: 20,
    });
    const labelled = {
      ...rect,
      boundElements: [{ id: label.id, type: "text" as const }],
    };

    expect(hits(labelled, INSIDE, label)).toBe(false);
    expect(hits(label, INSIDE, labelled)).toBe(false);
  });

  it("erases a frame only at its border", () => {
    const frame = newFrameElement({ ...BOX });

    expect(hits(frame, INSIDE)).toBe(false);
    expect(hits(frame, ACROSS_EDGE)).toBe(true);
  });

  it("never erases sticky notes, embeds or images", () => {
    const sticky = newStickyNoteElement({ type: "stickynote", ...BOX });
    const embeddable = newEmbeddableElement({ type: "embeddable", ...BOX });
    const image = newImageElement({ type: "image", ...BOX });

    for (const element of [sticky, embeddable, image]) {
      expect(hits(element, INSIDE)).toBe(false);
      expect(hits(element, ACROSS_EDGE)).toBe(false);
    }
  });

  it("still erases free text by touching it", () => {
    const text = newTextElement({
      text: "free",
      x: 60,
      y: 90,
      width: 80,
      height: 20,
    });

    expect(hits(text, INSIDE)).toBe(true);
  });
});
