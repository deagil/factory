// A table row or card that opens its item. A link or button inside it keeps
// its own destination; the rest of the surface opens the item.
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

import { tableBodyRow } from "./data-table.tsx";

/** Click and keyboard props that open `onOpen`, except from a link or button. */
export const opensItem = (onOpen: () => void) => ({
  tabIndex: 0,
  onClick: (event: MouseEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.closest("a, button")) {
      return;
    }
    onOpen();
  },
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    onOpen();
  },
});

export const OpenRow = ({
  onOpen,
  children,
}: {
  onOpen: () => void;
  children: ReactNode;
}) => (
  <tr
    {...opensItem(onOpen)}
    className={`cursor-pointer outline-none hover:bg-muted/40 focus-visible:bg-muted/40 ${tableBodyRow}`}
  >
    {children}
  </tr>
);
