// Inspect: the TanStack devtools and the raw system description (P1b.10).
import { TanStackDevtools } from "@tanstack/react-devtools";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { MenubarMenu } from "@workspace/ui/components/menubar";
import { useState } from "react";

import { describeSystem } from "../lib/api.ts";
import {
  SystemMenuCheckboxItem,
  SystemMenuContent,
  SystemMenuItem,
  SystemMenuSeparator,
  SystemMenuTrigger,
} from "./system-menu.tsx";

const DEVTOOLS_KEY = "factory.dev.devtools";

const readShown = () => {
  try {
    return localStorage.getItem(DEVTOOLS_KEY) === "on";
  } catch {
    return false;
  }
};

/** Opens what `system.describe` returns for you, as JSON, in a new tab. */
const openDescription = async () => {
  const description = await describeSystem();
  const blob = new Blob([JSON.stringify(description, null, 2)], {
    type: "application/json",
  });
  window.open(URL.createObjectURL(blob), "_blank");
};

const handleOpenDescription = () => {
  openDescription().catch(() => null);
};

const plugins = [
  { name: "Query", render: <ReactQueryDevtoolsPanel /> },
  { name: "Router", render: <TanStackRouterDevtoolsPanel /> },
];

export const InspectMenu = () => {
  const [shown, setShown] = useState(readShown);

  const show = (next: boolean) => {
    setShown(next);
    try {
      localStorage.setItem(DEVTOOLS_KEY, next ? "on" : "off");
    } catch {
      // Not remembered; it still applies now.
    }
  };

  return (
    <>
      <MenubarMenu>
        <SystemMenuTrigger>Inspect</SystemMenuTrigger>
        <SystemMenuContent>
          <SystemMenuCheckboxItem
            className="whitespace-nowrap"
            checked={shown}
            onCheckedChange={(checked) => show(checked === true)}
          >
            TanStack devtools
          </SystemMenuCheckboxItem>
          <SystemMenuSeparator />
          <SystemMenuItem
            className="whitespace-nowrap"
            onClick={handleOpenDescription}
          >
            Open system.describe
          </SystemMenuItem>
        </SystemMenuContent>
      </MenubarMenu>
      {shown ? <TanStackDevtools plugins={plugins} /> : null}
    </>
  );
};
