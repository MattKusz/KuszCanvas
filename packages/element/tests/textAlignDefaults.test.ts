import { TEXT_ALIGN, VERTICAL_ALIGN } from "@excalidraw/common";

import {
  newArrowElement,
  newElement,
  newStickyNoteElement,
  newTextElement,
} from "../src/newElement";
import {
  getDefaultBoundTextAlign,
  shouldRememberTextAlign,
} from "../src/textAlignDefaults";

const BASE = { x: 0, y: 0, width: 100, height: 60 };

const text = (containerId: string | null = null) =>
  newTextElement({ text: "label", containerId, ...BASE });

describe("getDefaultBoundTextAlign", () => {
  it("starts a sticky note's label top-left", () => {
    expect(
      getDefaultBoundTextAlign(
        newStickyNoteElement({ type: "stickynote", ...BASE }),
      ),
    ).toEqual({
      textAlign: TEXT_ALIGN.LEFT,
      verticalAlign: VERTICAL_ALIGN.TOP,
    });
  });

  it("starts a shape's or arrow's label centre-centre", () => {
    const centred = {
      textAlign: TEXT_ALIGN.CENTER,
      verticalAlign: VERTICAL_ALIGN.MIDDLE,
    };
    for (const type of ["rectangle", "diamond", "ellipse"] as const) {
      expect(getDefaultBoundTextAlign(newElement({ type, ...BASE }))).toEqual(
        centred,
      );
    }
    expect(
      getDefaultBoundTextAlign(newArrowElement({ type: "arrow", ...BASE })),
    ).toEqual(centred);
  });

  it("rejects a missing container", () => {
    expect(() => getDefaultBoundTextAlign(null as any)).toThrow(/container/);
  });
});

describe("shouldRememberTextAlign", () => {
  it("remembers a pick with no text targeted (tool defaults)", () => {
    expect(shouldRememberTextAlign([])).toBe(true);
  });

  it("remembers a pick that reaches loose text", () => {
    expect(shouldRememberTextAlign([text()])).toBe(true);
    expect(shouldRememberTextAlign([text("note"), text()])).toBe(true);
  });

  it("ignores a pick on labels only, so loose text stays left", () => {
    expect(shouldRememberTextAlign([text("note")])).toBe(false);
    expect(shouldRememberTextAlign([text("a"), text("b")])).toBe(false);
  });

  it("rejects a non-array", () => {
    expect(() => shouldRememberTextAlign(null as any)).toThrow(/array/);
  });
});
