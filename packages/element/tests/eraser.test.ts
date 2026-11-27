import { arrayToMap } from "@excalidraw/common";
import { pointFrom } from "@excalidraw/math";

import type { GlobalPoint, LocalPoint } from "@excalidraw/math";

import {
  getEraserOutcome,
  isEraserClickHit,
  isEraserIgnoredLabel,
  isEraserOutlineOnly,
  isEraserProtected,
} from "../src/eraser";
import {
  newElement,
  newEmbeddableElement,
  newFrameElement,
  newFreeDrawElement,
  newIframeElement,
  newImageElement,
  newLinearElement,
  newStickyNoteElement,
  newTextElement,
} from "../src/newElement";

import type { ExcalidrawElement } from "../src/types";

const BOX = { x: 0, y: 0, width: 100, height: 100 };

const rectangle = (opts: { frameId?: string } = {}) =>
  newElement({
    type: "rectangle",
    ...BOX,
    backgroundColor: "#ffc9c9",
    fillStyle: "solid",
    ...opts,
  });

const labelOf = (container: ExcalidrawElement) =>
  newTextElement({ text: "label", containerId: container.id, ...BOX });

const map = (...elements: ExcalidrawElement[]) => arrayToMap(elements);

describe("isEraserProtected", () => {
  it("protects sticky notes, embeds and images", () => {
    const sticky = newStickyNoteElement({ type: "stickynote", ...BOX });
    const embeddable = newEmbeddableElement({ type: "embeddable", ...BOX });
    const iframe = newIframeElement({ type: "iframe", ...BOX });
    const image = newImageElement({ type: "image", ...BOX });

    for (const element of [sticky, embeddable, iframe, image]) {
      expect(isEraserProtected(element, map(element))).toBe(true);
    }
  });

  it("protects a sticky note's label with its note", () => {
    const sticky = newStickyNoteElement({ type: "stickynote", ...BOX });
    const label = labelOf(sticky);

    expect(isEraserProtected(label, map(sticky, label))).toBe(true);
  });

  it("leaves shapes, frames, ink and free text erasable", () => {
    const rect = rectangle();
    const frame = newFrameElement({ ...BOX });
    const text = newTextElement({ text: "free", ...BOX });
    const label = labelOf(rect);
    const elementsMap = map(rect, frame, text, label);

    for (const element of [rect, frame, text, label]) {
      expect(isEraserProtected(element, elementsMap)).toBe(false);
    }
  });
});

describe("isEraserOutlineOnly", () => {
  it("is true for filled closed shapes and frames", () => {
    const outlineOnly = [
      rectangle(),
      newElement({ type: "ellipse", ...BOX, backgroundColor: "#ffc9c9" }),
      newElement({ type: "diamond", ...BOX, backgroundColor: "#ffc9c9" }),
      newFrameElement({ ...BOX }),
      newLinearElement({
        type: "line",
        ...BOX,
        polygon: true,
        points: [
          pointFrom<LocalPoint>(0, 0),
          pointFrom<LocalPoint>(100, 0),
          pointFrom<LocalPoint>(100, 100),
          pointFrom<LocalPoint>(0, 0),
        ],
      }),
    ];

    for (const element of outlineOnly) {
      expect(isEraserOutlineOnly(element)).toBe(true);
    }
  });

  it("is false for ink, text, open lines and arrows", () => {
    const notOutlineOnly = [
      newFreeDrawElement({ type: "freedraw", ...BOX, simulatePressure: true }),
      newTextElement({ text: "free", ...BOX }),
      newLinearElement({ type: "line", ...BOX }),
      newLinearElement({ type: "arrow", ...BOX }),
    ];

    for (const element of notOutlineOnly) {
      expect(isEraserOutlineOnly(element)).toBe(false);
    }
  });
});

describe("isEraserIgnoredLabel", () => {
  it("ignores the label of a shape, so the eraser cannot reach its fill", () => {
    const rect = rectangle();
    const label = labelOf(rect);

    expect(isEraserIgnoredLabel(label, map(rect, label))).toBe(true);
  });

  it("keeps arrow labels and free text as targets", () => {
    const arrow = newLinearElement({ type: "arrow", ...BOX });
    const arrowLabel = labelOf(arrow);
    const text = newTextElement({ text: "free", ...BOX });
    const elementsMap = map(arrow, arrowLabel, text);

    expect(isEraserIgnoredLabel(arrowLabel, elementsMap)).toBe(false);
    expect(isEraserIgnoredLabel(text, elementsMap)).toBe(false);
  });
});

describe("isEraserClickHit", () => {
  const at = (x: number, y: number) => pointFrom<GlobalPoint>(x, y);

  it("erases a filled shape or frame only when clicked on its border", () => {
    for (const element of [rectangle(), newFrameElement({ ...BOX })]) {
      const elementsMap = map(element);

      expect(isEraserClickHit(at(50, 50), element, elementsMap, 5)).toBe(false);
      expect(isEraserClickHit(at(0, 50), element, elementsMap, 5)).toBe(true);
    }
  });

  it("never erases a clicked sticky note, embed or image", () => {
    const sticky = newStickyNoteElement({ type: "stickynote", ...BOX });
    const embeddable = newEmbeddableElement({ type: "embeddable", ...BOX });
    const image = newImageElement({ type: "image", ...BOX });

    for (const element of [sticky, embeddable, image]) {
      const elementsMap = map(element);

      expect(isEraserClickHit(at(50, 50), element, elementsMap, 5)).toBe(false);
      expect(isEraserClickHit(at(0, 50), element, elementsMap, 5)).toBe(false);
    }
  });

  it("keeps the caller's hit for other elements", () => {
    const text = newTextElement({ text: "free", ...BOX });

    expect(isEraserClickHit(at(50, 50), text, map(text), 5)).toBe(true);
  });
});

describe("getEraserOutcome", () => {
  it("deletes pending elements and the labels of pending containers", () => {
    const rect = rectangle();
    const label = labelOf(rect);
    const elementsMap = map(rect, label);
    const pending = new Set([rect.id]);

    expect(getEraserOutcome(rect, pending, elementsMap)).toBe("delete");
    expect(getEraserOutcome(label, pending, elementsMap)).toBe("delete");
  });

  it("never deletes a protected element, even when pending via its group", () => {
    const sticky = newStickyNoteElement({ type: "stickynote", ...BOX });
    const embeddable = newEmbeddableElement({ type: "embeddable", ...BOX });
    const elementsMap = map(sticky, embeddable);
    const pending = new Set([sticky.id, embeddable.id]);

    expect(getEraserOutcome(sticky, pending, elementsMap)).toBeNull();
    expect(getEraserOutcome(embeddable, pending, elementsMap)).toBeNull();
  });

  it("erases a frame's shapes but releases its sticky notes and embeds", () => {
    const frame = newFrameElement({ ...BOX });
    const rect = rectangle({ frameId: frame.id });
    const sticky = newStickyNoteElement({
      type: "stickynote",
      ...BOX,
      frameId: frame.id,
    });
    const stickyLabel = { ...labelOf(sticky), frameId: frame.id };
    const embeddable = newEmbeddableElement({
      type: "embeddable",
      ...BOX,
      frameId: frame.id,
    });
    const elementsMap = map(frame, rect, sticky, stickyLabel, embeddable);
    const pending = new Set([frame.id]);

    expect(getEraserOutcome(frame, pending, elementsMap)).toBe("delete");
    expect(getEraserOutcome(rect, pending, elementsMap)).toBe("delete");
    expect(getEraserOutcome(sticky, pending, elementsMap)).toBe(
      "detachFromFrame",
    );
    expect(getEraserOutcome(stickyLabel, pending, elementsMap)).toBe(
      "detachFromFrame",
    );
    expect(getEraserOutcome(embeddable, pending, elementsMap)).toBe(
      "detachFromFrame",
    );
  });

  it("leaves untouched elements alone", () => {
    const rect = rectangle();

    expect(getEraserOutcome(rect, new Set(), map(rect))).toBeNull();
  });
});
