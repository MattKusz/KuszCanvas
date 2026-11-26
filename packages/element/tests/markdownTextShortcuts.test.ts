import {
  continueMarkdownList,
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

describe("continueMarkdownList (Enter in a list)", () => {
  /** applies Enter at the `|` caret; returns the marked result or null */
  const enter = (marked: string) => {
    const { value, start, end } = parse(marked);
    const edit = continueMarkdownList(value, start, end);
    if (!edit) {
      return null;
    }
    // the edit is also one replacement of the original value
    expect(
      value.slice(0, edit.replaceStart) +
        edit.replacement +
        value.slice(edit.replaceEnd),
    ).toBe(edit.value);
    return mark(edit.value, edit.selectionStart, edit.selectionEnd);
  };

  it("starts the next bullet with the same marker and indentation", () => {
    expect(enter("- one|")).toBe("- one\n- |");
    expect(enter("* one|")).toBe("* one\n* |");
    expect(enter("a\n  + nested|\nb")).toBe("a\n  + nested\n  + |\nb");
  });

  it("numbers the next ordered item", () => {
    expect(enter("1. one|")).toBe("1. one\n2. |");
    expect(enter("9) nine|")).toBe("9) nine\n10) |");
  });

  it("continues a task list with an open checkbox", () => {
    expect(enter("- [x] done|")).toBe("- [x] done\n- [ ] |");
    expect(enter("1. [ ] a|")).toBe("1. [ ] a\n2. [ ] |");
  });

  it("keeps quote markers", () => {
    expect(enter("> - quoted|")).toBe("> - quoted\n> - |");
  });

  it("moves the text after the caret into the new item", () => {
    expect(enter("- ab|cd")).toBe("- ab\n- |cd");
  });

  it("ends the list on an empty item", () => {
    expect(enter("- a\n- |")).toBe("- a\n|");
    expect(enter("- a\n- [ ] |")).toBe("- a\n|");
    expect(enter("> - |")).toBe("> |");
    expect(enter("- a\n- |\nb")).toBe("- a\n|\nb");
  });

  it("leaves Enter alone outside a list item's content", () => {
    expect(enter("plain|")).toBeNull();
    expect(enter("-not a list|")).toBeNull();
    expect(enter("|- a")).toBeNull();
    expect(enter("-| a")).toBeNull();
    expect(enter("| a\n- b")).toBeNull();
  });

  it("leaves Enter alone with a selection", () => {
    expect(continueMarkdownList("- abc", 2, 4)).toBeNull();
  });

  it("validates its inputs", () => {
    expect(() => continueMarkdownList(1 as unknown as string, 0, 0)).toThrow();
    expect(() => continueMarkdownList("- a", 4, 4)).toThrow();
    expect(() => continueMarkdownList("- a", 2, 1)).toThrow();
  });
});
