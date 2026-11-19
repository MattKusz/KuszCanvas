import { layoutMarkdownText } from "../src/markdownTextLayout";
import {
  MARKDOWN_HIGHLIGHT_COLOR,
  drawMarkdownText,
  getMarkdownPaintOps,
  type MarkdownDrawOptions,
} from "../src/markdownTextRender";

import type { MarkdownMeasure } from "../src/markdownTextLayout";
import type { FontString } from "../src/types";

const FONT = "20px Excalifont, Xiaolai" as FontString;
const measure: MarkdownMeasure = (text) => text.length * 10;

type Call = { op: string; args: unknown[]; fillStyle: unknown; font: string };

/** Records draw calls with the fill style and font current at each call. */
const createRecordingContext = () => {
  const calls: Call[] = [];
  const state = {
    fillStyle: "#000" as unknown,
    strokeStyle: "#000" as unknown,
    font: "",
    globalAlpha: 1,
    lineWidth: 1,
    textAlign: "start",
  };
  const stack: typeof state[] = [];
  const record =
    (op: string) =>
    (...args: unknown[]) => {
      calls.push({ op, args, fillStyle: state.fillStyle, font: state.font });
    };
  const context = new Proxy(state as Record<string, unknown>, {
    get(target, key: string) {
      if (key in target) {
        return target[key];
      }
      if (key === "save") {
        return () => stack.push({ ...state });
      }
      if (key === "restore") {
        return () => Object.assign(state, stack.pop());
      }
      return record(key);
    },
    set(target, key: string, value) {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { context, calls };
};

const draw = (text: string, overrides: Partial<MarkdownDrawOptions> = {}) => {
  const layout = layoutMarkdownText(text, FONT, measure);
  if (!layout) {
    throw new Error("expected a Markdown layout");
  }
  const { context, calls } = createRecordingContext();
  drawMarkdownText(context, {
    layout,
    font: FONT,
    width: layout.width,
    textAlign: "left",
    fontSize: 20,
    lineHeightPx: 25,
    verticalOffset: 18,
    color: "#1e1e1e",
    accentColor: "#e83e8c",
    ...overrides,
  });
  return calls;
};

const texts = (calls: Call[]) =>
  calls.filter((call) => call.op === "fillText").map((call) => call.args[0]);

describe("drawMarkdownText", () => {
  it("draws visible text only, in the run's font", () => {
    const calls = draw("**ab** c");
    expect(texts(calls)).toEqual(["ab", " c"]);
    const bold = calls.find((call) => call.args[0] === "ab")!;
    expect(bold.font).toBe(`bold ${FONT}`);
    expect(bold.args.slice(1)).toEqual([0, 18]);
    const plain = calls.find((call) => call.args[0] === " c")!;
    expect(plain.args[1]).toBe(20);
  });

  it("draws tags in the accent colour", () => {
    const calls = draw("see #tag");
    const tag = calls.find((call) => call.args[0] === "#tag")!;
    expect(tag.fillStyle).toBe("#e83e8c");
    const plain = calls.find((call) => call.args[0] === "see ")!;
    expect(plain.fillStyle).toBe("#1e1e1e");
  });

  it("draws a highlight behind highlighted text", () => {
    const calls = draw("==hi==");
    const rectIndex = calls.findIndex(
      (call) =>
        call.op === "fillRect" && call.fillStyle === MARKDOWN_HIGHLIGHT_COLOR,
    );
    const textIndex = calls.findIndex((call) => call.args[0] === "hi");
    expect(rectIndex).toBeGreaterThanOrEqual(0);
    expect(rectIndex).toBeLessThan(textIndex);
  });

  it("strikes through and underlines", () => {
    expect(draw("~~x~~").some((call) => call.op === "fillRect")).toBe(true);
    expect(draw("<u>x</u>").some((call) => call.op === "fillRect")).toBe(true);
  });

  it("draws a dot for a bullet and a label for an ordered item", () => {
    expect(draw("- a").some((call) => call.op === "arc")).toBe(true);
    expect(texts(draw("1. a"))).toEqual(["1.", "a"]);
  });

  it("offsets each line for centre and right alignment", () => {
    const layout = layoutMarkdownText("**a**\n**abc**", FONT, measure)!;
    const calls = draw("**a**\n**abc**", {
      layout,
      width: 100,
      textAlign: "right",
    });
    const xs = calls
      .filter((call) => call.op === "fillText")
      .map((call) => call.args[1]);
    expect(xs).toEqual([100 - 10, 100 - 30]);
  });

  it("validates its inputs", () => {
    const { context } = createRecordingContext();
    expect(() =>
      drawMarkdownText(context, {
        layout: null as any,
        font: FONT,
        width: 10,
        textAlign: "left",
        fontSize: 20,
        lineHeightPx: 25,
        verticalOffset: 18,
        color: "#000",
        accentColor: "#000",
      }),
    ).toThrow(/layout/);
    expect(() => draw("**a**", { lineHeightPx: Number.NaN })).toThrow(
      /lineHeightPx/,
    );
    expect(() => draw("**a**", { accentColor: "" })).toThrow(/accentColor/);
  });
});

describe("getMarkdownPaintOps", () => {
  const ops = (text: string) => {
    const layout = layoutMarkdownText(text, FONT, measure)!;
    return getMarkdownPaintOps({
      layout,
      font: FONT,
      width: layout.width,
      textAlign: "left",
      fontSize: 20,
      lineHeightPx: 25,
      verticalOffset: 18,
      color: "#1e1e1e",
      accentColor: "#e83e8c",
    });
  };

  it("frames a table with a closing bottom border", () => {
    const result = ops("| a | b |\n|---|---|\n| c | d |");
    const rects = result.filter((op) => op.kind === "rect");
    // the body row ends at 3 lines: its bottom border sits on that edge
    expect(
      rects.some(
        (op) => op.kind === "rect" && Math.abs(op.y + op.height - 75) < 1e-9,
      ),
    ).toBe(true);
    const header = result.find((op) => op.kind === "text" && op.text === "a");
    expect(header?.kind === "text" && header.style.bold).toBe(true);
  });

  it("draws a quote bar per depth over the full row", () => {
    const bars = ops("> > q").filter((op) => op.kind === "rect");
    expect(bars).toHaveLength(2);
    expect(bars.every((op) => op.kind === "rect" && op.height === 25)).toBe(
      true,
    );
  });
});
