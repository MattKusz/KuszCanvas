import {
  getMarkdownShortcutStyle,
  toggleMarkdownStyle,
  type MarkdownShortcutStyle,
} from "../src/markdownTextShortcuts";

/** `[` and `]` mark the selection; `|` marks a collapsed caret */
const parse = (marked: string) => {
  const caret = marked.indexOf("|");
  if (caret !== -1) {
    return {
      value: marked.slice(0, caret) + marked.slice(caret + 1),
      start: caret,
      end: caret,
    };
  }
  const start = marked.indexOf("[");
  const end = marked.indexOf("]") - 1;
  return {
    value: marked.replace("[", "").replace("]", ""),
    start,
    end,
  };
};

const mark = (value: string, start: number, end: number) =>
  start === end
    ? `${value.slice(0, start)}|${value.slice(start)}`
    : `${value.slice(0, start)}[${value.slice(start, end)}]${value.slice(end)}`;

const toggle = (marked: string, style: MarkdownShortcutStyle) => {
  const { value, start, end } = parse(marked);
  const result = toggleMarkdownStyle(value, start, end, style);
  // the replacement describes the same edit as the full value
  expect(
    value.slice(0, result.replaceStart) +
      result.replacement +
      value.slice(result.replaceEnd),
  ).toBe(result.value);
  return mark(result.value, result.selectionStart, result.selectionEnd);
};

describe("toggleMarkdownStyle", () => {
  it("wraps a selection in bold, italic or underline markers", () => {
    expect(toggle("a [word] b", "bold")).toBe("a **[word]** b");
    expect(toggle("a [word] b", "italic")).toBe("a *[word]* b");
    expect(toggle("a [word] b", "underline")).toBe("a <u>[word]</u> b");
  });

  it("removes markers around the selection", () => {
    expect(toggle("a **[word]** b", "bold")).toBe("a [word] b");
    expect(toggle("a *[word]* b", "italic")).toBe("a [word] b");
    expect(toggle("a <u>[word]</u> b", "underline")).toBe("a [word] b");
    expect(toggle("a <U>[word]</U> b", "underline")).toBe("a [word] b");
  });

  it("removes markers inside the selection", () => {
    expect(toggle("a [**word**] b", "bold")).toBe("a [word] b");
    expect(toggle("a [<u>word</u>] b", "underline")).toBe("a [word] b");
  });

  it("combines bold and italic on one star run", () => {
    expect(toggle("**[w]**", "italic")).toBe("***[w]***");
    expect(toggle("*[w]*", "bold")).toBe("***[w]***");
    expect(toggle("***[w]***", "bold")).toBe("*[w]*");
    expect(toggle("***[w]***", "italic")).toBe("**[w]**");
  });

  it("recognises underscore emphasis", () => {
    expect(toggle("_[w]_", "italic")).toBe("[w]");
    expect(toggle("__[w]__", "bold")).toBe("[w]");
  });

  it("leaves surrounding whitespace outside the markers", () => {
    expect(toggle("a [word ]b", "bold")).toBe("a **[word]** b");
  });

  it("inserts an empty pair at a caret and removes an empty pair", () => {
    expect(toggle("ab|", "bold")).toBe("ab**|**");
    expect(toggle("ab**|**", "bold")).toBe("ab|");
    expect(toggle("ab|", "underline")).toBe("ab<u>|</u>");
    expect(toggle("ab<u>|</u>", "underline")).toBe("ab|");
  });

  it("styles each selected line on its own, skipping blank lines", () => {
    expect(toggle("[one\n\ntwo]", "bold")).toBe("**[one**\n\n**two]**");
  });

  it("adds the style to unstyled lines when some lines have it", () => {
    expect(toggle("[**one**\ntwo]", "bold")).toBe("**[one**\n**two]**");
  });

  it("removes the style when every selected line has it", () => {
    expect(toggle("[**one**\n**two**]", "bold")).toBe("[one\ntwo]");
  });

  it("keeps list and quote prefixes outside the markers", () => {
    expect(toggle("[- item]", "bold")).toBe("- **[item]**");
    expect(toggle("[> quote]", "italic")).toBe("> *[quote]*");
  });

  it("leaves a whitespace-only selection unchanged", () => {
    expect(toggle("a[  ]b", "bold")).toBe("a[  ]b");
  });

  it("validates its inputs", () => {
    expect(() => toggleMarkdownStyle(null as any, 0, 0, "bold")).toThrow(
      /value/,
    );
    expect(() => toggleMarkdownStyle("ab", 2, 1, "bold")).toThrow(/selection/);
    expect(() => toggleMarkdownStyle("ab", 0, 3, "bold")).toThrow(/selection/);
    expect(() => toggleMarkdownStyle("ab", 0.5, 1, "bold")).toThrow(
      /selection/,
    );
    expect(() => toggleMarkdownStyle("ab", 0, 1, "strike" as any)).toThrow(
      /style/,
    );
  });
});

describe("getMarkdownShortcutStyle", () => {
  const key = (
    k: string,
    overrides: Partial<Parameters<typeof getMarkdownShortcutStyle>[0]> = {},
  ) =>
    getMarkdownShortcutStyle({
      key: k,
      code: `Key${k.toUpperCase()}`,
      ctrlOrCmd: true,
      shiftKey: false,
      altKey: false,
      ...overrides,
    });

  it("maps Ctrl/Cmd + B, I and U", () => {
    expect(key("b")).toBe("bold");
    expect(key("i")).toBe("italic");
    expect(key("u")).toBe("underline");
  });

  it("ignores other keys and modifier combinations", () => {
    expect(key("k")).toBe(null);
    expect(key("b", { ctrlOrCmd: false })).toBe(null);
    expect(key("b", { shiftKey: true })).toBe(null);
    expect(key("b", { altKey: true })).toBe(null);
  });

  it("falls back to the physical key on non-Latin layouts", () => {
    expect(key("и", { code: "KeyB" })).toBe("bold");
  });

  it("validates its input", () => {
    expect(() => getMarkdownShortcutStyle(null as any)).toThrow(/event/);
  });
});
