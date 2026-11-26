import {
  hasMarkdownSyntax,
  isPlainMarkdown,
  parseMarkdownInline,
  parseMarkdownText,
} from "../src/markdownText";

import type { MarkdownRun } from "../src/markdownText";

/** visible text with a style tag per run, e.g. "a[b:bold]c" */
const describeRuns = (runs: readonly MarkdownRun[]) =>
  runs
    .filter((run) => !run.hidden)
    .map((run) => {
      const flags = (
        ["bold", "italic", "strike", "underline", "highlight", "code"] as const
      ).filter((flag) => run.style[flag]);
      return flags.length ? `[${run.text}:${flags.join("+")}]` : run.text;
    })
    .join("");

const visibleText = (runs: readonly MarkdownRun[]) =>
  runs
    .filter((run) => !run.hidden)
    .map((run) => run.text)
    .join("");

describe("parseMarkdownInline", () => {
  it("throws on non-string input", () => {
    expect(() => parseMarkdownInline(42 as unknown as string)).toThrow();
  });

  it("covers every character exactly once, in order", () => {
    const text = "a **b** _c_ ~~d~~ ==e== `f` <u>g</u> #tag \\*h";
    const runs = parseMarkdownInline(text);
    let offset = 0;
    for (const run of runs) {
      expect(run.start).toBe(offset);
      expect(run.text).toBe(text.slice(run.start, run.end));
      offset = run.end;
    }
    expect(offset).toBe(text.length);
  });

  it("parses bold, italic and bold-italic", () => {
    expect(describeRuns(parseMarkdownInline("a **b** c"))).toBe("a [b:bold] c");
    expect(describeRuns(parseMarkdownInline("a __b__ c"))).toBe("a [b:bold] c");
    expect(describeRuns(parseMarkdownInline("a *b* c"))).toBe("a [b:italic] c");
    expect(describeRuns(parseMarkdownInline("a _b_ c"))).toBe("a [b:italic] c");
    expect(describeRuns(parseMarkdownInline("***b***"))).toBe(
      "[b:bold+italic]",
    );
  });

  it("nests emphasis", () => {
    expect(describeRuns(parseMarkdownInline("**a *b* c**"))).toBe(
      "[a :bold][b:bold+italic][ c:bold]",
    );
    expect(describeRuns(parseMarkdownInline("**a *b***"))).toBe(
      "[a :bold][b:bold+italic]",
    );
  });

  it("parses strike, highlight, underline and code", () => {
    expect(describeRuns(parseMarkdownInline("~~s~~ ==h== <u>u</u> `c`"))).toBe(
      "[s:strike] [h:highlight] [u:underline] [c:code]",
    );
  });

  it("does not parse emphasis inside code", () => {
    expect(describeRuns(parseMarkdownInline("`**x**`"))).toBe("[**x**:code]");
  });

  it("keeps snake_case and intraword underscores literal", () => {
    expect(describeRuns(parseMarkdownInline("snake_case_name"))).toBe(
      "snake_case_name",
    );
    expect(describeRuns(parseMarkdownInline("a_b and c_d"))).toBe(
      "a_b and c_d",
    );
  });

  it("renders unmatched markers literally", () => {
    expect(describeRuns(parseMarkdownInline("**open"))).toBe("**open");
    expect(describeRuns(parseMarkdownInline("a * b"))).toBe("a * b");
    expect(describeRuns(parseMarkdownInline("~~x"))).toBe("~~x");
    expect(describeRuns(parseMarkdownInline("x = y == z"))).toBe("x = y == z");
    expect(describeRuns(parseMarkdownInline("`open"))).toBe("`open");
    expect(describeRuns(parseMarkdownInline("<u>open"))).toBe("<u>open");
    expect(describeRuns(parseMarkdownInline("~single~"))).toBe("~single~");
  });

  it("honours backslash escapes", () => {
    expect(describeRuns(parseMarkdownInline("\\*not italic\\*"))).toBe(
      "*not italic*",
    );
    expect(visibleText(parseMarkdownInline("a\\\\b"))).toBe("a\\b");
    // a backslash before a letter is literal
    expect(visibleText(parseMarkdownInline("C:\\temp"))).toBe("C:\\temp");
  });

  // Obsidian indexes `#tags` itself; the canvas draws them as plain text
  it("leaves Obsidian tags unstyled", () => {
    expect(describeRuns(parseMarkdownInline("see #project/kusch now"))).toBe(
      "see #project/kusch now",
    );
    expect(describeRuns(parseMarkdownInline("#Bauträger"))).toBe("#Bauträger");
    expect(describeRuns(parseMarkdownInline("**#tag**"))).toBe("[#tag:bold]");
    expect(
      Object.keys(parseMarkdownInline("#tag")[0].style).includes("tag"),
    ).toBe(false);
  });

  it("matches emphasis across newlines in one paragraph", () => {
    expect(describeRuns(parseMarkdownInline("**a\nb**"))).toBe("[a\nb:bold]");
  });
});

describe("parseMarkdownText", () => {
  it("throws on non-string input", () => {
    expect(() => parseMarkdownText(null as unknown as string)).toThrow();
  });

  it("returns one line per source line", () => {
    expect(parseMarkdownText("a\n\nb")).toHaveLength(3);
    expect(parseMarkdownText("")).toHaveLength(1);
  });

  it("carries inline styles across lines of a paragraph", () => {
    const lines = parseMarkdownText("**bold that\nwraps** here");
    expect(describeRuns(lines[0].runs)).toBe("[bold that:bold]");
    expect(describeRuns(lines[1].runs)).toBe("[wraps:bold] here");
  });

  it("does not carry styles across a blank line", () => {
    const lines = parseMarkdownText("**a\n\nb**");
    expect(describeRuns(lines[0].runs)).toBe("**a");
    expect(describeRuns(lines[2].runs)).toBe("b**");
  });

  it("parses task list items after the list marker", () => {
    const lines = parseMarkdownText(
      "- [ ] open\n* [x] done\n1. [X] numbered\n- [ ]",
    );
    expect(lines.map((line) => line.marker)).toEqual([
      { kind: "bullet", task: "open" },
      { kind: "bullet", task: "done" },
      { kind: "ordered", label: "1.", task: "done" },
      { kind: "bullet", task: "open" },
    ]);
    // the checkbox is a marker: content starts after it
    expect(lines[0].contentStart).toBe(6);
    expect(visibleText(lines[0].runs)).toBe("open");
    expect(lines[3].contentStart).toBe(5);
    expect(lines[3].runs).toEqual([]);
  });

  it("strikes through a done task, continuation lines included", () => {
    const lines = parseMarkdownText("- [x] done **bold**\n  more\n- [ ] open");
    expect(describeRuns(lines[0].runs)).toBe(
      "[done :strike][bold:bold+strike]",
    );
    expect(describeRuns(lines[1].runs)).toBe("[more:strike]");
    expect(describeRuns(lines[2].runs)).toBe("open");
  });

  it("needs a list marker, a single space or x, and whitespace after", () => {
    const markers = parseMarkdownText(
      "[ ] bare\n- [] empty\n- [y] other\n- [ ]tight\n- [  ] wide",
    ).map((line) => line.marker);
    expect(markers).toEqual([
      null,
      { kind: "bullet", task: null },
      { kind: "bullet", task: null },
      { kind: "bullet", task: null },
      { kind: "bullet", task: null },
    ]);
  });

  it("parses bullet and ordered list items", () => {
    const lines = parseMarkdownText("- one\n* two\n+ three\n1. first\n12) x");
    expect(lines.map((line) => line.marker)).toEqual([
      { kind: "bullet", task: null },
      { kind: "bullet", task: null },
      { kind: "bullet", task: null },
      { kind: "ordered", label: "1.", task: null },
      { kind: "ordered", label: "12)", task: null },
    ]);
    expect(lines.every((line) => line.listLevel === 1)).toBe(true);
    expect(visibleText(lines[0].runs)).toBe("one");
    expect(visibleText(lines[3].runs)).toBe("first");
  });

  it("nests list items by indentation", () => {
    const lines = parseMarkdownText("- a\n  - b\n    - c\n  - d\n- e");
    expect(lines.map((line) => line.listLevel)).toEqual([1, 2, 3, 2, 1]);
  });

  it("treats a following plain line as a lazy continuation of a list item", () => {
    const lines = parseMarkdownText("- **item that\ncontinues** here\nmore");
    expect(lines[1].marker).toBeNull();
    expect(lines[1].listLevel).toBe(1);
    expect(describeRuns(lines[1].runs)).toBe("[continues:bold] here");
    expect(lines[2].listLevel).toBe(1);
  });

  it("does not continue a list across a blank line", () => {
    const lines = parseMarkdownText("- item\n\nparagraph");
    expect(lines[2].listLevel).toBe(0);
  });

  it("parses quotes, nested quotes and quoted list items", () => {
    const lines = parseMarkdownText("> quote\n> > nested\n> - item");
    expect(lines.map((line) => line.quoteDepth)).toEqual([1, 2, 1]);
    expect(visibleText(lines[0].runs)).toBe("quote");
    expect(visibleText(lines[1].runs)).toBe("nested");
    expect(lines[2].marker).toEqual({ kind: "bullet", task: null });
  });

  it("renders headings and horizontal rules literally", () => {
    const lines = parseMarkdownText("# Heading\n---");
    expect(visibleText(lines[0].runs)).toBe("# Heading");
    expect(lines[0].marker).toBeNull();
    expect(visibleText(lines[1].runs)).toBe("---");
  });

  it("renders fenced code literally", () => {
    const lines = parseMarkdownText("```\n**not bold**\n- not a list\n```");
    expect(describeRuns(lines[1].runs)).toBe("**not bold**");
    expect(lines[2].marker).toBeNull();
    expect(visibleText(lines[3].runs)).toBe("```");
  });

  it("parses a table with alignment, header and escaped pipes", () => {
    const lines = parseMarkdownText(
      "| Name | Qty |\n| :--- | --: |\n| **beam** | 2 \\| 3 |\nafter",
    );
    expect(lines[0].table?.isHeader).toBe(true);
    expect(lines[1].table?.isDelimiter).toBe(true);
    expect(lines[2].table?.isHeader).toBe(false);
    expect(lines[0].table?.align).toEqual(["left", "right"]);
    expect(
      lines[2].table?.cells.map((cell) => describeRuns(cell.runs)),
    ).toEqual(["[beam:bold]", "2 | 3"]);
    expect(lines[0].table?.tableId).toBe(lines[2].table?.tableId);
    expect(lines[3].table).toBeNull();
  });

  it("does not treat a lone pipe line as a table", () => {
    const lines = parseMarkdownText("a | b\nplain");
    expect(lines[0].table).toBeNull();
  });

  it("forces continuation lines from a wrap alignment", () => {
    // "1. done" is a wrapped tail of the first line, not a list item
    const lines = parseMarkdownText("released in 2024.\n1. done", {
      continuation: [false, true],
    });
    expect(lines[1].marker).toBeNull();
    expect(lines[1].listLevel).toBe(0);
    expect(visibleText(lines[1].runs)).toBe("1. done");
  });

  it("validates the continuation option length", () => {
    expect(() =>
      parseMarkdownText("a\nb", { continuation: [false] }),
    ).toThrow();
  });
});

describe("hasMarkdownSyntax / isPlainMarkdown", () => {
  it("detects candidate syntax cheaply", () => {
    expect(hasMarkdownSyntax("plain words, numbers 1.5 and dots.")).toBe(false);
    expect(hasMarkdownSyntax("a **b**")).toBe(true);
    expect(hasMarkdownSyntax("- item")).toBe(true);
    expect(hasMarkdownSyntax("#tag")).toBe(false);
    expect(hasMarkdownSyntax("1. item")).toBe(true);
  });

  it("reports parsed text without effect as plain", () => {
    expect(isPlainMarkdown(parseMarkdownText("a * b and c_d_e"))).toBe(true);
    expect(isPlainMarkdown(parseMarkdownText("a *b*"))).toBe(false);
    expect(isPlainMarkdown(parseMarkdownText("- a"))).toBe(false);
    expect(isPlainMarkdown(parseMarkdownText("> a"))).toBe(false);
    expect(isPlainMarkdown(parseMarkdownText("#tag"))).toBe(true);
  });
});
