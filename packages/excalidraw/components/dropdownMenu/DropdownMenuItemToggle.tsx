/**
 * KuszCanvas: a menu row with an on/off switch on the right. Selecting the
 * row flips the switch and keeps the menu open.
 *
 * The row holds its own state while the menu is open, so it flips at once
 * even when the host renders the menu once and only re-reads its setting
 * the next time the menu opens; a new `checked` prop still wins.
 */
import clsx from "clsx";
import React, { useEffect, useState } from "react";

import "../Switch.scss";

import DropdownMenuItem from "./DropdownMenuItem";

import type { DropdownMenuItemProps } from "./DropdownMenuItem";

export type DropdownMenuItemToggleProps = Omit<
  DropdownMenuItemProps,
  "onSelect" | "onChange" | "selected" | "badge"
> & {
  checked: boolean;
  /** called with the new value after the row is selected */
  onChange: (checked: boolean) => void;
};

const DropdownMenuItemToggle = ({
  checked,
  onChange,
  className,
  children,
  ...rest
}: DropdownMenuItemToggleProps) => {
  if (typeof onChange !== "function") {
    throw new Error("DropdownMenuItemToggle: onChange is required");
  }
  const [isOn, setIsOn] = useState(checked === true);
  useEffect(() => {
    setIsOn(checked === true);
  }, [checked]);

  return (
    <DropdownMenuItem
      {...rest}
      role="menuitemcheckbox"
      aria-checked={isOn}
      className={clsx("dropdown-menu-item--toggle", className)}
      onSelect={(event) => {
        // keep the menu open, like the theme toggle
        event.preventDefault();
        const next = !isOn;
        setIsOn(next);
        onChange(next);
      }}
      badge={
        <span
          className={clsx("Switch dropdown-menu-item__switch", {
            toggled: isOn,
          })}
          aria-hidden="true"
        />
      }
    >
      {children}
    </DropdownMenuItem>
  );
};
DropdownMenuItemToggle.displayName = "DropdownMenuItemToggle";

export default DropdownMenuItemToggle;
