import { layoutMarkdownText } from "../src/markdownTextLayout";
import { getMarkdownPaintOps } from "../src/markdownTextRender";
import {
  findMarkdownCheckboxAt,
  getMarkdownSourceLine,
  getMarkdownTaskLines,
  toggleMarkdownTask,
  toggleMarkdownTaskInTexts,
} from "../src/markdownTaskToggle";

import type { MarkdownMeasure } from "../src/markdownTextLayout";
import type { FontString } from "../src/types";

const FONT = "20px Excalifont, Xiaolai" as FontString;
const measure: MarkdownMeasure = (text) => text.length * 10;

const opsFor = (visualText: string, sourceText = visualText) => {
  const layout = layoutMarkdownText(visualText, FONT, measure, sourceText)!;
  return getMarkdownPaintOps({
    layout,
    font: FONT,
    width: layout.width,
    textAlign: "left",
    fontSize: 20,
    lineHeightPx: 25,
    verticalOffset: 18,
    color: "#1e1e1e",
  });
};

describe("getMarkdownTaskLines", () => {
  it("lists the source lines of task items", () => {
    expect(
      getMarkdownTaskLines("a\n- [ ] b\n- c\n1. [x] d\n> - [X] e"),
    ).toEqual([1, 3, 4]);
    expect(getMarkdownTaskLines("[ ] not a task")).toEqual([]);
  });

  it("validates its input", () => {
    expect(() => getMarkdownTaskLines(1 as unknown as string)).toThrow();
  });
});

describe("toggleMarkdownTask", () => {
  it("ticks an open task and clears a done one, on that line only", () => {
    expect(toggleMarkdownTask("- [ ] a\n- [ ] b", 1)).toBe("- [ ] a\n- [x] b");
    expect(toggleMarkdownTask("- [x] a", 0)).toBe("- [ ] a");
    expect(toggleMarkdownTask("- [X] a", 0)).toBe("- [ ] a");
    expect(toggleMarkdownTask("> 2. [ ] a", 0)).toBe("> 2. [x] a");
    expect(toggleMarkdownTask("  - [ ]", 0)).toBe("  - [x]");
  });

  it("refuses a line that isn't a task", () => {
    expect(() => toggleMarkdownTask("- a", 0)).toThrow(/task/);
    expect(() => toggleMarkdownTask("- [ ] a", 1)).toThrow();
    expect(() => toggleMarkdownTask("- [ ] a", -1)).toThrow();
    expect(() => toggleMarkdownTask(null as unknown as string, 0)).toThrow();
  });
});

describe("toggleMarkdownTaskInTexts", () => {
  it("toggles the same task in the raw source as in the displayed text", () => {
    // the host's raw source can differ from the displayed text above a task
    expect(
      toggleMarkdownTaskInTexts(
        { originalText: "link\nmore\n- [ ] a", rawText: "[[link]]\n- [ ] a" },
        2,
      ),
    ).toEqual({
      originalText: "link\nmore\n- [x] a",
      rawText: "[[link]]\n- [x] a",
    });
  });

  it("follows the displayed text when the raw source is empty or equal", () => {
    expect(
      toggleMarkdownTaskInTexts({ originalText: "- [ ] a", rawText: "" }, 0),
    ).toEqual({ originalText: "- [x] a", rawText: "- [x] a" });
    expect(
      toggleMarkdownTaskInTexts(
        { originalText: "- [x] a", rawText: "- [x] a" },
        0,
      ),
    ).toEqual({ originalText: "- [ ] a", rawText: "- [ ] a" });
  });

  it("returns null when the raw source's tasks don't match", () => {
    expect(
      toggleMarkdownTaskInTexts(
        { originalText: "- [ ] a\n- [ ] b", rawText: "- [ ] a" },
        1,
      ),
    ).toBeNull();
    expect(
      toggleMarkdownTaskInTexts(
        { originalText: "- [ ] a", rawText: "- [x] a" },
        0,
      ),
    ).toBeNull();
  });
});

describe("getMarkdownSourceLine", () => {
  it("maps a visual line to its source line", () => {
    expect(getMarkdownSourceLine("a\nb", "a\nb", 1)).toBe(1);
    // "- [ ] long text" wrapped onto two visual lines
    const source = "x\n- [ ] long text\n- [ ] c";
    const visual = "x\n- [ ] long\ntext\n- [ ] c";
    expect(getMarkdownSourceLine(source, visual, 1)).toBe(1);
    expect(getMarkdownSourceLine(source, visual, 2)).toBe(1);
    expect(getMarkdownSourceLine(source, visual, 3)).toBe(2);
  });

  it("returns null when the texts don't align", () => {
    expect(getMarkdownSourceLine("a", "b", 0)).toBeNull();
  });

  it("validates its inputs", () => {
    expect(() => getMarkdownSourceLine("a", "a", 1)).toThrow();
    expect(() => getMarkdownSourceLine("a", "a", 0.5)).toThrow();
  });
});

describe("findMarkdownCheckboxAt", () => {
  it("hits a checkbox, with slop around it, and reports its visual line", () => {
    const ops = opsFor("x\n- [ ] a\n- [x] b");
    const boxes = ops.flatMap((op) => (op.kind === "checkbox" ? [op] : []));
    expect(boxes.map((box) => box.line)).toEqual([1, 2]);
    const [first, second] = boxes;
    const centre = (box: typeof first) => ({
      x: box.x + box.size / 2,
      y: box.y + box.size / 2,
    });
    expect(findMarkdownCheckboxAt(ops, centre(first), 0)).toBe(1);
    expect(findMarkdownCheckboxAt(ops, centre(second), 0)).toBe(2);
    const justLeft = { x: first.x - 2, y: centre(first).y };
    expect(findMarkdownCheckboxAt(ops, justLeft, 0)).toBeNull();
    expect(findMarkdownCheckboxAt(ops, justLeft, 3)).toBe(1);
    // the item's text is not the checkbox
    expect(
      findMarkdownCheckboxAt(ops, { x: first.x + 40, y: centre(first).y }, 0),
    ).toBeNull();
  });

  it("validates its inputs", () => {
    expect(() =>
      findMarkdownCheckboxAt(null as any, { x: 0, y: 0 }, 0),
    ).toThrow();
    expect(() =>
      findMarkdownCheckboxAt([], { x: Number.NaN, y: 0 }, 0),
    ).toThrow();
    expect(() => findMarkdownCheckboxAt([], { x: 0, y: 0 }, -1)).toThrow();
  });
});
