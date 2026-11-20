import {
  OBSIDIAN_COMMON_HOST_PROTOCOL_VERSION,
  configureObsidianCommonHost,
  type ObsidianCommonHostAdapter,
} from "@excalidraw/common";

import {
  MARKDOWN_CODE_FONT_FAMILY,
  alignWrappedLines,
  getMarkdownRunFont,
  layoutMarkdownText,
  wrapMarkdownText,
} from "../src/markdownTextLayout";
import {
  isMarkdownTextLayoutActive,
  withRawTextLayout,
} from "../src/markdownTextMode";
import { measureText } from "../src/textMeasurements";
import { wrapText } from "../src/textWrapping";

import type { MarkdownMeasure } from "../src/markdownTextLayout";
import type { FontString } from "../src/types";

const FONT = "20px Excalifont, Xiaolai" as FontString;
const EM = 20;

/** 10 per char, 11 bold, 12 monospace: separates styles in widths */
const measure: MarkdownMeasure = (text, font) => {
  if (typeof text !== "string" || typeof font !== "string") {
    throw new Error("measure: bad input");
  }
  const perChar = font.includes("monospace")
    ? 12
    : /\bbold\b/.test(font)
    ? 11
    : 10;
  return text.length * perChar;
};

const makeHost = (markdown: boolean): ObsidianCommonHostAdapter => ({
  protocolVersion: OBSIDIAN_COMMON_HOST_PROTOCOL_VERSION,
  getDeviceInfo: () => null,
  getDesktopUIMode: () => "tray",
  getPreferredUIMode: () => "tray",
  getCanvasLimits: () => ({ areaLimit: 16777216, widthHeightLimit: 32767 }),
  getHighlightColor: () => "rgba(0,0,0,1)",
  isBlackboardModeEnabled: () => false,
  isMarkdownTextRenderingEnabled: () => markdown,
});

describe("getMarkdownRunFont", () => {
  const plain = {
    bold: false,
    italic: false,
    strike: false,
    underline: false,
    highlight: false,
    code: false,
  };

  it("prefixes weight and style", () => {
    expect(getMarkdownRunFont(FONT, plain)).toBe(FONT);
    expect(getMarkdownRunFont(FONT, { ...plain, bold: true })).toBe(
      `bold ${FONT}`,
    );
    expect(
      getMarkdownRunFont(FONT, { ...plain, bold: true, italic: true }),
    ).toBe(`italic bold ${FONT}`);
  });

  it("uses the code family at the same size", () => {
    expect(getMarkdownRunFont(FONT, { ...plain, code: true })).toBe(
      `20px ${MARKDOWN_CODE_FONT_FAMILY}`,
    );
  });

  it("rejects a malformed font string", () => {
    expect(() =>
      getMarkdownRunFont("Excalifont" as FontString, plain),
    ).toThrow();
  });
});

describe("layoutMarkdownText", () => {
  it("returns null for text without Markdown effect", () => {
    expect(layoutMarkdownText("plain text\nsecond", FONT, measure)).toBeNull();
    expect(layoutMarkdownText("a * b", FONT, measure)).toBeNull();
  });

  it("gives hidden markers zero width and styled runs their own width", () => {
    const layout = layoutMarkdownText("**ab** c", FONT, measure)!;
    expect(layout.lines).toHaveLength(1);
    expect(layout.width).toBe(2 * 11 + 2 * 10);
    expect(layout.lines[0].segments.map((s) => [s.text, s.x])).toEqual([
      ["ab", 0],
      [" c", 22],
    ]);
  });

  it("measures a plain line in one call so kerning matches raw text", () => {
    const calls: string[] = [];
    const spy: MarkdownMeasure = (text, font) => {
      calls.push(text);
      return measure(text, font);
    };
    layoutMarkdownText("**a**\nplain words here", FONT, spy);
    expect(calls).toContain("plain words here");
  });

  it("lays out a bullet with a hanging indent", () => {
    const layout = layoutMarkdownText("- item", FONT, measure)!;
    const line = layout.lines[0];
    expect(line.bullet?.kind).toBe("dot");
    expect(line.segments[0].x).toBe(1.4 * EM);
    expect(line.width).toBe(1.4 * EM + 40);
  });

  it("indents a wrapped continuation like its item, using the source", () => {
    const layout = layoutMarkdownText(
      "- one two\nthree",
      FONT,
      measure,
      "- one two three",
    )!;
    expect(layout.lines[1].bullet).toBeNull();
    expect(layout.lines[1].segments[0].x).toBe(1.4 * EM);
  });

  it("uses the source to tell a wrapped tail from a list item", () => {
    const visual = "**released** in\n2024. done";
    const withSource = layoutMarkdownText(
      visual,
      FONT,
      measure,
      "**released** in 2024. done",
    )!;
    expect(withSource.lines[1].bullet).toBeNull();
    expect(withSource.lines[1].segments[0].x).toBe(0);

    const withoutSource = layoutMarkdownText(visual, FONT, measure)!;
    expect(withoutSource.lines[1].bullet?.kind).toBe("label");
  });

  it("pads code spans but not tags", () => {
    expect(layoutMarkdownText("a #ab", FONT, measure)).toBeNull();
    expect(layoutMarkdownText("**#ab**", FONT, measure)!.width).toBe(33);
    expect(layoutMarkdownText("`ab`", FONT, measure)!.width).toBe(
      24 + 2 * 0.2 * EM,
    );
  });

  it("indents quotes and records a bar per depth", () => {
    const layout = layoutMarkdownText("> q\n> > r", FONT, measure)!;
    expect(layout.lines[0].quoteBars).toHaveLength(1);
    expect(layout.lines[1].quoteBars).toHaveLength(2);
    expect(layout.lines[0].segments[0].x).toBe(0.9 * EM);
    expect(layout.lines[1].segments[0].x).toBe(1.8 * EM);
  });

  it("lays out a table in columns and shares the delimiter line", () => {
    const layout = layoutMarkdownText(
      "| a | bb |\n|---|---|\n| ccc | d |",
      FONT,
      measure,
    )!;
    const pad = 0.5 * EM;
    const [header, delimiter, row] = layout.lines;
    expect(header.table?.columnWidths).toEqual([30 + 2 * pad, 22 + 2 * pad]);
    expect(header.width).toBe(30 + 22 + 4 * pad);
    expect(layout.width).toBe(header.width);
    expect(delimiter.height).toBe(0);
    expect(header.top).toBe(0);
    expect(header.height).toBe(1.5);
    expect(row.top).toBe(1.5);
    expect(row.height).toBe(1.5);
    // header cells are bold
    expect(header.segments[0].font).toBe(`bold ${FONT}`);
    // right/centre alignment inside the column
    expect(row.segments[0].x).toBe(pad);
  });

  it("keeps line count and tops for every visual line", () => {
    const layout = layoutMarkdownText("**a**\n\nb", FONT, measure)!;
    expect(layout.lines.map((line) => line.top)).toEqual([0, 1, 2]);
  });

  it("falls back to plain layout for right-to-left text", () => {
    expect(layoutMarkdownText("**שלום**", FONT, measure)).toBeNull();
  });
});

describe("alignWrappedLines", () => {
  it("marks wrapped continuation lines", () => {
    expect(alignWrappedLines("a b c\nd", "a b\nc\nd")).toEqual([
      false,
      true,
      false,
    ]);
  });

  it("returns null when the wrapped text does not come from the source", () => {
    expect(alignWrappedLines("a b", "x y")).toBeNull();
  });

  it("aligns empty lines", () => {
    expect(alignWrappedLines("a\n\nb", "a\n\nb")).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe("wrapMarkdownText", () => {
  it("breaks by rendered width, not raw width", () => {
    const lines = wrapMarkdownText("**aaaa bbbb**", FONT, 50, measure);
    expect(lines.map((line) => line.text)).toEqual(["**aaaa", "bbbb**"]);
    expect(lines.map((line) => [line.start, line.end])).toEqual([
      [0, 6],
      [7, 13],
    ]);
  });

  it("does not wrap when the rendered width fits but the raw would not", () => {
    // raw "**aaa**" = 70 > 60, rendered "aaa" bold = 33
    const lines = wrapMarkdownText("**aaa**", FONT, 60, measure);
    expect(lines.map((line) => line.text)).toEqual(["**aaa**"]);
  });

  it("wraps list items inside their hanging indent", () => {
    const lines = wrapMarkdownText("- aaa bbb", FONT, 70, measure);
    expect(lines.map((line) => line.text)).toEqual(["- aaa", "bbb"]);
  });

  it("never wraps table rows", () => {
    const text = "| aaaa | bbbb |\n|---|---|\n| c | d |";
    const lines = wrapMarkdownText(text, FONT, 20, measure);
    expect(lines.map((line) => line.text)).toEqual(text.split("\n"));
  });

  it("splits a word longer than the line", () => {
    const lines = wrapMarkdownText("**abcdef**", FONT, 33, measure);
    expect(lines.map((line) => line.text)).toEqual(["**abc", "def**"]);
  });

  it("validates inputs", () => {
    expect(() => wrapMarkdownText(1 as any, FONT, 10, measure)).toThrow();
    expect(() => wrapMarkdownText("a", FONT, 10, null as any)).toThrow();
  });
});

describe("measureText / wrapText with the host flag", () => {
  let dispose: (() => void) | null = null;

  afterEach(() => {
    dispose?.();
    dispose = null;
  });

  it("is inactive without a host", () => {
    expect(isMarkdownTextLayoutActive()).toBe(false);
    expect(measureText("**ab**", FONT, 1.25 as any).width).toBe(60);
  });

  it("measures rendered Markdown when enabled", () => {
    dispose = configureObsidianCommonHost(makeHost(true));
    expect(isMarkdownTextLayoutActive()).toBe(true);
    // the test environment measures 10px per character
    expect(measureText("**ab**", FONT, 1.25 as any).width).toBe(20);
  });

  it("measures raw text inside the editing scope", () => {
    dispose = configureObsidianCommonHost(makeHost(true));
    expect(
      withRawTextLayout(() => measureText("**ab**", FONT, 1.25 as any).width),
    ).toBe(60);
    expect(isMarkdownTextLayoutActive()).toBe(true);
  });

  it("restores the scope when the callback throws", () => {
    dispose = configureObsidianCommonHost(makeHost(true));
    expect(() =>
      withRawTextLayout(() => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(isMarkdownTextLayoutActive()).toBe(true);
  });

  it("wraps plain text exactly as without Markdown", () => {
    const text =
      "a reasonably long plain sentence that wraps several times\nand a second line";
    const raw = wrapText(text, FONT, 120);
    dispose = configureObsidianCommonHost(makeHost(true));
    expect(wrapText(text, FONT, 120)).toBe(raw);
  });

  it("wraps Markdown by rendered width when enabled", () => {
    dispose = configureObsidianCommonHost(makeHost(true));
    expect(wrapText("**aaa**", FONT, 40)).toBe("**aaa**");
  });
});
