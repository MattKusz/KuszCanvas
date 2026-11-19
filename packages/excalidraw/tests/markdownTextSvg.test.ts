import { SVG_NS } from "@excalidraw/common";
import { MARKDOWN_CODE_FONT_FAMILY } from "@excalidraw/element";

import type { MarkdownPaintOp } from "@excalidraw/element";
import type { FontString } from "@excalidraw/element/types";

import { appendMarkdownPaintOpsToSvg } from "../renderer/markdownTextSvg";

const PLAIN = {
  bold: false,
  italic: false,
  strike: false,
  underline: false,
  highlight: false,
  code: false,
  tag: false,
};

const FAMILY = "Excalifont, Xiaolai";
const FONT = `20px ${FAMILY}` as FontString;

const render = (ops: MarkdownPaintOp[]) => {
  const parent = document.createElementNS(SVG_NS, "g");
  appendMarkdownPaintOpsToSvg(parent, ops, FAMILY, 20);
  return parent;
};

describe("appendMarkdownPaintOpsToSvg", () => {
  it("writes a positioned text node per run with weight and style", () => {
    const parent = render([
      {
        kind: "text",
        text: "ab",
        x: 4,
        y: 18,
        font: `italic bold ${FONT}` as FontString,
        style: { ...PLAIN, bold: true, italic: true },
        color: "#123456",
      },
    ]);
    const text = parent.querySelector("text")!;
    expect(text.textContent).toBe("ab");
    expect(text.getAttribute("x")).toBe("4");
    expect(text.getAttribute("y")).toBe("18");
    expect(text.getAttribute("font-family")).toBe(FAMILY);
    expect(text.getAttribute("font-size")).toBe("20px");
    expect(text.getAttribute("font-weight")).toBe("bold");
    expect(text.getAttribute("font-style")).toBe("italic");
    expect(text.getAttribute("fill")).toBe("#123456");
    expect(text.getAttribute("text-anchor")).toBe("start");
  });

  it("uses the code family for code runs", () => {
    const parent = render([
      {
        kind: "text",
        text: "x",
        x: 0,
        y: 0,
        font: FONT,
        style: { ...PLAIN, code: true },
        color: "#000",
      },
    ]);
    expect(parent.querySelector("text")!.getAttribute("font-family")).toBe(
      MARKDOWN_CODE_FONT_FAMILY,
    );
  });

  it("writes rects with opacity and corner radius, and circles", () => {
    const parent = render([
      {
        kind: "rect",
        x: 1,
        y: 2,
        width: 3,
        height: 4,
        color: "#e83e8c",
        alpha: 0.15,
        radius: 2,
      },
      { kind: "circle", cx: 5, cy: 6, r: 2, color: "#000" },
    ]);
    const rect = parent.querySelector("rect")!;
    expect(rect.getAttribute("fill")).toBe("#e83e8c");
    expect(rect.getAttribute("opacity")).toBe("0.15");
    expect(rect.getAttribute("rx")).toBe("2");
    const circle = parent.querySelector("circle")!;
    expect(circle.getAttribute("cx")).toBe("5");
    expect(circle.getAttribute("r")).toBe("2");
  });

  it("validates its inputs", () => {
    const parent = document.createElementNS(SVG_NS, "g");
    expect(() =>
      appendMarkdownPaintOpsToSvg(parent, null as any, FAMILY, 20),
    ).toThrow(/ops/);
    expect(() => appendMarkdownPaintOpsToSvg(parent, [], "", 20)).toThrow(
      /fontFamily/,
    );
  });
});
