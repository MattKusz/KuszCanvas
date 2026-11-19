import {
  getSourceLineRange,
  layoutMarkdownLivePreview,
} from "../src/markdownTextPreview";

import type { MarkdownMeasure } from "../src/markdownTextLayout";
import type { FontString } from "../src/types";

const FONT = "20px Excalifont" as FontString;
const measure: MarkdownMeasure = (text) => text.length * 10;

const preview = (
  sourceText: string,
  first: number,
  last = first,
  visualText = sourceText,
) =>
  layoutMarkdownLivePreview({
    visualText,
    sourceText,
    font: FONT,
    measure,
    revealed: { first, last },
  });

const lineTexts = (layout: ReturnType<typeof preview>) =>
  layout!.lines.map((line) => line.segments.map((s) => s.text).join(""));

describe("getSourceLineRange", () => {
  it("returns the source lines a selection touches", () => {
    expect(getSourceLineRange("a\nb\nc", 2, 2)).toEqual({ first: 1, last: 1 });
    expect(getSourceLineRange("a\nb\nc", 0, 4)).toEqual({ first: 0, last: 2 });
    // a caret right after a line's text is on that line
    expect(getSourceLineRange("ab\ncd", 2, 2)).toEqual({ first: 0, last: 0 });
  });

  it("validates its inputs", () => {
    expect(() => getSourceLineRange("ab", 1, 0)).toThrow(/selection/);
    expect(() => getSourceLineRange("ab", 0, 5)).toThrow(/selection/);
  });
});

describe("layoutMarkdownLivePreview", () => {
  it("renders Markdown on other lines and raw text on the caret's line", () => {
    const layout = preview("**a**\n**b**", 1);
    expect(lineTexts(layout)).toEqual(["a", "**b**"]);
    expect(layout!.lines[0].segments[0].style.bold).toBe(true);
    const raw = layout!.lines[1];
    expect(raw.segments[0].style.bold).toBe(false);
    expect(raw.segments[0].x).toBe(0);
    expect(raw.width).toBe(50);
  });

  it("keeps one layout line per visual line", () => {
    const layout = preview("**a**\nplain\n**b**", 1);
    expect(layout!.lines.map((line) => line.top)).toEqual([0, 1, 2]);
  });

  it("reveals every visual line of a wrapped source line", () => {
    const source = "**aa bb**\n**cc**";
    const visual = "**aa\nbb**\n**cc**";
    expect(lineTexts(preview(source, 0, 0, visual))).toEqual([
      "**aa",
      "bb**",
      "cc",
    ]);
    const styled = preview(source, 1, 1, visual);
    expect(lineTexts(styled)).toEqual(["aa", "bb", "**cc**"]);
    expect(styled!.lines[1].segments[0].style.bold).toBe(true);
  });

  it("drops block decoration from revealed lines only", () => {
    const layout = preview("- a\n- b", 1);
    expect(layout!.lines[0].bullet?.kind).toBe("dot");
    expect(layout!.lines[1].bullet).toBe(null);
    expect(lineTexts(layout)).toEqual(["a", "- b"]);
  });

  it("reveals a whole table when the caret is in one of its rows", () => {
    const layout = preview("| a |\n|---|\n| c |\n**x**", 2);
    expect(lineTexts(layout)).toEqual(["| a |", "|---|", "| c |", "x"]);
    expect(layout!.lines.slice(0, 3).map((line) => line.table)).toEqual([
      null,
      null,
      null,
    ]);
    expect(layout!.lines.map((line) => [line.top, line.height])).toEqual([
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
    ]);
  });

  it("returns null when nothing would render differently from raw text", () => {
    expect(preview("plain\ntext", 0)).toBe(null);
    expect(preview("**a**", 0)).toBe(null);
  });

  it("returns null when the visual text is not a wrap of the source", () => {
    expect(preview("**a**\n**b**", 1, 1, "**a**\n**c**")).toBe(null);
  });

  it("validates its inputs", () => {
    expect(() => preview("**a**", 1, 0)).toThrow(/revealed/);
    expect(() =>
      layoutMarkdownLivePreview({
        visualText: "a",
        sourceText: 1 as any,
        font: FONT,
        measure,
        revealed: { first: 0, last: 0 },
      }),
    ).toThrow(/sourceText/);
  });
});
