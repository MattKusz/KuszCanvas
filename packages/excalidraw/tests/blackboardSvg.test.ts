import {
  BLACKBOARD_SVG_TEXTURE,
  createBlackboardSvgFilter,
} from "../renderer/chalkSvg";

const filter = () => createBlackboardSvgFilter(document, "board");

const frequencies = (node: Element) =>
  String(node.getAttribute("baseFrequency")).trim().split(/\s+/).map(Number);

describe("createBlackboardSvgFilter", () => {
  it("draws no chalk specks", () => {
    const results = [...filter().querySelectorAll("[result]")].map((node) =>
      node.getAttribute("result"),
    );
    expect(results.some((name) => /speck/i.test(String(name)))).toBe(false);
  });

  it("keeps the board a solid slate between the streaks", () => {
    const results = [...filter().querySelectorAll("[result]")].map((node) =>
      node.getAttribute("result"),
    );
    expect(results.some((name) => /mottle|grain/i.test(String(name)))).toBe(
      false,
    );
  });

  it("leaves erased chalk faint, not white", () => {
    expect(BLACKBOARD_SVG_TEXTURE.residue).toBeLessThanOrEqual(0.08);
  });

  it("draws erased chalk as streaks running left to right", () => {
    const stretched = [...filter().querySelectorAll("feTurbulence")]
      .map(frequencies)
      .filter((pair) => pair.length === 2);
    // long along x, fine across it: at least 8 : 1, and none upright
    expect(stretched.some(([x, y]) => y / x >= 8)).toBe(true);
    expect(stretched.some(([x, y]) => x / y > 1)).toBe(false);
  });

  it("bends the streaks into eraser arcs", () => {
    expect(filter().querySelector("feDisplacementMap")).not.toBeNull();
  });

  it("validates its inputs", () => {
    expect(() => createBlackboardSvgFilter(null as any, "board")).toThrow(
      /doc/,
    );
    expect(() => createBlackboardSvgFilter(document, "")).toThrow(/id/);
  });
});
