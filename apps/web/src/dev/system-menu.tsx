// The developer bar's menus, styled like a desktop menu bar rather than the
// app's popover cards: hung from the bar, compact system type, a solid
// highlight and a checkmark column. They open and close without animation,
// so the Design menu's slow motion never slows the menu that turns it off.
// The shared menubar in @workspace/ui keeps shadcn's look; this skin is only
// for local development.
import {
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarLabel,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "@workspace/ui/components/menubar";
import { cn } from "@workspace/ui/lib/utils";
import type { ComponentProps } from "react";

/** Bar height minus trigger height, halved: the menu meets the bar's edge. */
const BELOW_BAR_PX = 5;
/** The menu's padding, so a submenu's first row lines up with its parent. */
const SUBMENU_ALIGN_PX = -5;

// The overrides repeat the shared component's variants exactly, so `cn`
// replaces them instead of leaving both.
const surface = cn(
  "min-w-52 rounded-[7px] bg-[#10263b]/90 p-[5px] [font-family:system-ui] text-[13px] leading-[18px] text-[#e3eef7]",
  "shadow-[0_12px_32px_-6px_rgb(2_8_16/0.65),0_2px_6px_rgb(2_8_16/0.45)] ring-1 ring-white/15 dark:ring-white/15",
  "**:data-[slot$=-item]:focus:bg-[#2f6bd0] **:data-[slot$=-item]:data-highlighted:bg-[#2f6bd0]",
  "**:data-[slot$=-trigger]:focus:bg-[#2f6bd0] **:data-[slot$=-trigger]:aria-expanded:bg-[#2f6bd0]!",
  "**:data-[slot$=-separator]:bg-white/15"
);

const row = cn(
  "min-h-[22px] gap-2 rounded-[4px] py-0.5 pr-3 pl-[22px] text-[13px] leading-[18px]",
  "focus:bg-[#2f6bd0] focus:text-white focus:**:text-white",
  "data-highlighted:bg-[#2f6bd0] data-highlighted:text-white",
  "data-inset:pl-[22px] data-disabled:opacity-40",
  "[&_svg]:size-3! [&_svg]:stroke-[2.5]"
);

export const SystemMenuTrigger = ({
  className,
  ...props
}: ComponentProps<typeof MenubarTrigger>) => (
  <MenubarTrigger
    className={cn(
      "h-[22px] rounded-[4px] px-2.5 py-0 [font-family:system-ui] text-[13px] font-medium text-inherit",
      "hover:bg-white/15 focus-visible:bg-white/15 aria-expanded:bg-white/25",
      className
    )}
    {...props}
  />
);

export const SystemMenuContent = ({
  className,
  sideOffset = BELOW_BAR_PX,
  alignOffset = 0,
  ...props
}: ComponentProps<typeof MenubarContent>) => (
  <MenubarContent
    sideOffset={sideOffset}
    alignOffset={alignOffset}
    // Wide enough for its rows, not just its trigger.
    className={cn(surface, "w-auto", className)}
    {...props}
  />
);

export const SystemMenuSubContent = ({
  className,
  alignOffset = SUBMENU_ALIGN_PX,
  ...props
}: ComponentProps<typeof MenubarSubContent>) => (
  <MenubarSubContent
    alignOffset={alignOffset}
    className={cn(surface, "min-w-36", className)}
    {...props}
  />
);

export const SystemMenuItem = ({
  className,
  ...props
}: ComponentProps<typeof MenubarItem>) => (
  <MenubarItem
    className={cn(
      row,
      "px-3 pl-[22px] not-data-[variant=destructive]:focus:**:text-white",
      className
    )}
    {...props}
  />
);

export const SystemMenuCheckboxItem = ({
  className,
  ...props
}: ComponentProps<typeof MenubarCheckboxItem>) => (
  <MenubarCheckboxItem className={cn(row, className)} {...props} />
);

export const SystemMenuRadioItem = ({
  className,
  ...props
}: ComponentProps<typeof MenubarRadioItem>) => (
  <MenubarRadioItem className={cn(row, className)} {...props} />
);

export const SystemMenuSubTrigger = ({
  className,
  ...props
}: ComponentProps<typeof MenubarSubTrigger>) => (
  <MenubarSubTrigger
    className={cn(
      row,
      "px-3 pl-[22px]",
      "data-popup-open:bg-[#2f6bd0] data-popup-open:text-white data-open:bg-[#2f6bd0] data-open:text-white",
      "[&_svg]:opacity-70",
      className
    )}
    {...props}
  />
);

/** A section heading, aligned with the rows' text. */
export const SystemMenuLabel = ({
  className,
  ...props
}: ComponentProps<typeof MenubarLabel>) => (
  <MenubarLabel
    className={cn(
      "px-3 pt-1 pb-0.5 pl-[22px] text-[11px] leading-4 font-semibold text-white/50",
      className
    )}
    {...props}
  />
);

export const SystemMenuSeparator = ({
  className,
  ...props
}: ComponentProps<typeof MenubarSeparator>) => (
  <MenubarSeparator
    className={cn("mx-2.5 my-[5px] h-px bg-white/15", className)}
    {...props}
  />
);

/** A shortcut, right-aligned and muted, as `⌘⇧D`. */
export const SystemMenuShortcut = ({
  className,
  ...props
}: ComponentProps<typeof MenubarShortcut>) => (
  <MenubarShortcut
    className={cn(
      "pl-6 text-[13px] tracking-normal text-white/45 tabular-nums group-focus/menubar-item:text-white/85 group-data-highlighted/menubar-item:text-white/85",
      className
    )}
    {...props}
  />
);
