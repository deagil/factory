import {
  Menubar,
  MenubarContent,
  MenubarGroup,
  MenubarLabel,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "@workspace/ui/components/menubar";
import { useEffect, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";

import {
  MOTION_RATES,
  motionRateFrom,
  motionRateLabel,
  readMotionRate,
  subscribeMotionRate,
  watchMotionRate,
  writeMotionRate,
} from "./motion.ts";
import type { MotionRate } from "./motion.ts";

const blueprintInk = "#0e2438";

// Fine and coarse lines, like a cutting mat printed on blueprint stock.
// The inset covers the line that would otherwise sit on the window edge.
const blueprint: CSSProperties = {
  backgroundColor: blueprintInk,
  backgroundImage: [
    "linear-gradient(to right, rgb(118 156 184 / 0.28) 1px, transparent 1px)",
    "linear-gradient(to bottom, rgb(118 156 184 / 0.28) 1px, transparent 1px)",
    "linear-gradient(to right, rgb(146 180 204 / 0.42) 1px, transparent 1px)",
    "linear-gradient(to bottom, rgb(146 180 204 / 0.42) 1px, transparent 1px)",
  ].join(","),
  backgroundPosition: "-1px -1px",
  backgroundSize: "8px 8px, 8px 8px, 24px 24px, 24px 24px",
  boxShadow: `inset 0 0 0 1px ${blueprintInk}`,
};

const menuShadow =
  "shadow-[0_18px_44px_-8px_rgb(15_23_42/0.45),0_8px_18px_-6px_rgb(15_23_42/0.38)]";

// Local-development menu, mounted only while `import.meta.env.DEV` is set.
// New developer tools belong in a menu here.
const serverMotionRate = (): MotionRate => 1;

const chooseRate = (value: unknown) => {
  writeMotionRate(motionRateFrom(String(value)));
};

export const DevMenuBar = () => {
  const rate = useSyncExternalStore<MotionRate>(
    subscribeMotionRate,
    readMotionRate,
    serverMotionRate
  );

  useEffect(
    () =>
      watchMotionRate(
        rate,
        () => document.getAnimations(),
        requestAnimationFrame,
        cancelAnimationFrame
      ),
    [rate]
  );

  return (
    <div
      className="flex h-8 shrink-0 items-center px-1.5 text-[#d6e7f4] [&_[data-slot=menubar-trigger]]:text-inherit [&_[data-slot=menubar-trigger]]:hover:bg-white/20 [&_[data-slot=menubar-trigger]]:aria-expanded:bg-white/30"
      style={blueprint}
    >
      <Menubar
        aria-label="Developer"
        className="h-full min-w-0 flex-1 justify-start rounded-none border-0 bg-transparent p-0 shadow-none"
      >
        <MenubarMenu>
          <MenubarTrigger className="font-semibold">Factory</MenubarTrigger>
          <MenubarContent className={menuShadow}>
            <MenubarGroup>
              <MenubarLabel>Local development</MenubarLabel>
            </MenubarGroup>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger>Design</MenubarTrigger>
          <MenubarContent className={menuShadow}>
            <MenubarSub>
              <MenubarSubTrigger className="whitespace-nowrap">
                Animation speed
              </MenubarSubTrigger>
              <MenubarSubContent className={menuShadow}>
                <MenubarGroup>
                  <MenubarRadioGroup
                    value={String(rate)}
                    onValueChange={chooseRate}
                  >
                    {MOTION_RATES.map((item) => (
                      <MenubarRadioItem
                        key={item.rate}
                        value={String(item.rate)}
                        closeOnClick
                      >
                        {item.label}
                      </MenubarRadioItem>
                    ))}
                  </MenubarRadioGroup>
                </MenubarGroup>
              </MenubarSubContent>
            </MenubarSub>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>
      {rate === 1 ? null : (
        <p className="px-2 text-xs text-[#9eb8cc] tabular-nums">
          {motionRateLabel(rate)}
        </p>
      )}
    </div>
  );
};
