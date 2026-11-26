import {
  OBSIDIAN_COMMON_HOST_PROTOCOL_VERSION,
  configureObsidianCommonHost,
  type ObsidianCommonHostAdapter,
  type ObsidianCommonHostDisposer,
} from "@excalidraw/common";

import { applyMarkdownListContinuation } from "../wysiwyg/textWysiwyg.markdown";

describe("applyMarkdownListContinuation", () => {
  const flags = { markdown: true };
  let dispose: ObsidianCommonHostDisposer | null = null;
  const host: ObsidianCommonHostAdapter = {
    protocolVersion: OBSIDIAN_COMMON_HOST_PROTOCOL_VERSION,
    getDeviceInfo: () => null,
    getDesktopUIMode: () => "tray",
    getPreferredUIMode: () => "tray",
    getCanvasLimits: () => ({
      areaLimit: 16_777_216,
      widthHeightLimit: 32_767,
    }),
    getHighlightColor: () => "#0076ff",
    isBlackboardModeEnabled: () => false,
    isMarkdownTextRenderingEnabled: () => flags.markdown,
  };

  beforeEach(() => {
    flags.markdown = true;
    dispose = configureObsidianCommonHost(host);
  });

  afterEach(() => {
    dispose?.();
    dispose = null;
    document.body.innerHTML = "";
  });

  const setup = (value: string, caret = value.length) => {
    const editable = document.createElement("textarea");
    document.body.appendChild(editable);
    editable.value = value;
    editable.setSelectionRange(caret, caret);
    const inputs: string[] = [];
    editable.addEventListener("input", () => inputs.push(editable.value));
    return { editable, inputs };
  };

  const enter = (init: KeyboardEventInit = {}) =>
    new KeyboardEvent("keydown", {
      key: "Enter",
      cancelable: true,
      bubbles: true,
      ...init,
    });

  it("starts the next bullet and reports the edit", () => {
    const { editable, inputs } = setup("- one");
    const event = enter();
    expect(applyMarkdownListContinuation(event, editable, () => false)).toBe(
      true,
    );
    expect(event.defaultPrevented).toBe(true);
    expect(editable.value).toBe("- one\n- ");
    expect(editable.selectionStart).toBe(8);
    expect(editable.selectionEnd).toBe(8);
    expect(inputs).toEqual(["- one\n- "]);
  });

  it("ends the list on an empty item", () => {
    const { editable } = setup("- one\n- ");
    expect(applyMarkdownListContinuation(enter(), editable, () => false)).toBe(
      true,
    );
    expect(editable.value).toBe("- one\n");
  });

  it("leaves modified Enter, an open suggester and plain lines alone", () => {
    const cases: [string, KeyboardEventInit, boolean][] = [
      ["- one", { shiftKey: true }, false],
      ["- one", { ctrlKey: true }, false],
      ["- one", { metaKey: true }, false],
      ["- one", { altKey: true }, false],
      ["- one", { isComposing: true }, false],
      ["- one", {}, true],
      ["plain", {}, false],
    ];
    for (const [value, init, suggesterOpen] of cases) {
      const { editable } = setup(value);
      const event = enter(init);
      expect(
        applyMarkdownListContinuation(event, editable, () => suggesterOpen),
      ).toBe(false);
      expect(event.defaultPrevented).toBe(false);
      expect(editable.value).toBe(value);
    }
  });

  it("is off unless the host renders Markdown", () => {
    flags.markdown = false;
    const { editable } = setup("- one");
    expect(applyMarkdownListContinuation(enter(), editable, () => false)).toBe(
      false,
    );
    expect(editable.value).toBe("- one");
  });

  it("validates its inputs", () => {
    const { editable } = setup("- one");
    expect(() =>
      applyMarkdownListContinuation(null as any, editable, () => false),
    ).toThrow();
    expect(() =>
      applyMarkdownListContinuation(enter(), editable, null as any),
    ).toThrow();
  });
});
