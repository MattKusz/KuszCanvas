/**
 * KuszCanvas: a menu row with an on/off switch, used for the host's render
 * flags (blackboard mode, Markdown text) in the main menu.
 */
import React from "react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { fireEvent, render } from "@testing-library/react";
import { vi } from "vitest";

import DropdownMenuItemToggle from "./DropdownMenuItemToggle";

const renderToggle = ({
  checked: initial = false,
  ...props
}: Partial<React.ComponentProps<typeof DropdownMenuItemToggle>> = {}) => {
  const onChange = vi.fn();
  const ui = (checked: boolean) => (
    <DropdownMenuPrimitive.Root open>
      <DropdownMenuPrimitive.Content>
        <DropdownMenuItemToggle
          checked={checked}
          onChange={onChange}
          data-testid="toggle"
          {...props}
        >
          Blackboard
        </DropdownMenuItemToggle>
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Root>
  );
  const result = render(ui(initial));
  const item = () => result.getByTestId("toggle");
  const knob = () => item().querySelector(".dropdown-menu-item__switch")!;
  return { ...result, ui, item, knob, onChange };
};

describe("DropdownMenuItemToggle", () => {
  it("shows its state as a checkable menu item with a switch", () => {
    const { item, knob } = renderToggle({ checked: true });
    expect(item().getAttribute("role")).toBe("menuitemcheckbox");
    expect(item().getAttribute("aria-checked")).toBe("true");
    expect(knob().classList.contains("Switch")).toBe(true);
    expect(knob().classList.contains("toggled")).toBe(true);
    expect(item().textContent).toContain("Blackboard");
  });

  it("flips on click, reports the new value and keeps the menu open", () => {
    const { item, knob, onChange } = renderToggle({ checked: false });
    fireEvent.click(item());
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(item().getAttribute("aria-checked")).toBe("true");
    expect(knob().classList.contains("toggled")).toBe(true);
    fireEvent.click(item());
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(item().getAttribute("aria-checked")).toBe("false");
    // still rendered: selecting did not close the menu
    expect(item()).toBeTruthy();
  });

  it("follows a new checked prop from the host", () => {
    const { item, rerender, ui } = renderToggle({ checked: false });
    rerender(ui(true));
    expect(item().getAttribute("aria-checked")).toBe("true");
  });

  it("requires an onChange handler", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderToggle({ onChange: undefined as any })).toThrow(
      /onChange/,
    );
  });
});
