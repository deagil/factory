import {
  Menubar,
  MenubarGroup,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarSub,
} from "@workspace/ui/components/menubar";
import { useEffect, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";

import { ApiMenu } from "./api-menu.tsx";
import { InspectMenu } from "./inspect-menu.tsx";
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
import { SessionMenu } from "./session-menu.tsx";
import {
  SystemMenuContent,
  SystemMenuItem,
  SystemMenuLabel,
  SystemMenuRadioItem,
  SystemMenuSubContent,
  SystemMenuSubTrigger,
  SystemMenuTrigger,
} from "./system-menu.tsx";

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

// Local-development menu, mounted only while `import.meta.env.DEV` is set.
// New developer tools belong in a menu here.
// From vite.config.ts: the branch, change and database this server runs on.
// Tests run without it.
const change =
  typeof __FACTORY_CHANGE__ === "undefined"
    ? { change: "", branch: "", database: "" }
    : __FACTORY_CHANGE__;
const changeFacts: [string, string][] = [
  ["Change", change.change],
  ["Branch", change.branch],
  ["Database", change.database],
];

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
      className="flex h-8 shrink-0 items-center px-1.5 [font-family:system-ui] text-[13px] text-[#d6e7f4]"
      style={blueprint}
    >
      <Menubar
        aria-label="Developer"
        className="h-full min-w-0 flex-1 justify-start gap-0.5 rounded-none border-0 bg-transparent p-0 shadow-none"
      >
        <MenubarMenu>
          <SystemMenuTrigger className="font-semibold">
            Factory
          </SystemMenuTrigger>
          <SystemMenuContent>
            <MenubarGroup>
              <SystemMenuLabel>Local development</SystemMenuLabel>
              {changeFacts.map(([label, value]) => (
                <SystemMenuItem
                  key={label}
                  className="whitespace-nowrap"
                  disabled={!value}
                  onClick={() => navigator.clipboard?.writeText(value)}
                >
                  {label}
                  <span className="ml-auto pl-6 font-mono opacity-70">
                    {value || "—"}
                  </span>
                </SystemMenuItem>
              ))}
            </MenubarGroup>
          </SystemMenuContent>
        </MenubarMenu>
        <SessionMenu />
        <ApiMenu />
        <InspectMenu />
        <MenubarMenu>
          <SystemMenuTrigger>Design</SystemMenuTrigger>
          <SystemMenuContent>
            <MenubarSub>
              <SystemMenuSubTrigger className="whitespace-nowrap">
                Animation speed
              </SystemMenuSubTrigger>
              <SystemMenuSubContent>
                <MenubarGroup>
                  <MenubarRadioGroup
                    value={String(rate)}
                    onValueChange={chooseRate}
                  >
                    {MOTION_RATES.map((item) => (
                      <SystemMenuRadioItem
                        key={item.rate}
                        value={String(item.rate)}
                        closeOnClick
                      >
                        {item.label}
                      </SystemMenuRadioItem>
                    ))}
                  </MenubarRadioGroup>
                </MenubarGroup>
              </SystemMenuSubContent>
            </MenubarSub>
          </SystemMenuContent>
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
