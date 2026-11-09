// API: recent calls, dry runs, added latency and forced errors (P1b.10).
import { useNavigate } from "@tanstack/react-router";
import {
  MenubarGroup,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarSub,
} from "@workspace/ui/components/menubar";
import { useEffect, useSyncExternalStore } from "react";

import { setApiDevHooks } from "../lib/api.ts";
import type { ApiCallRecord } from "../lib/api.ts";
import { apiDevHooks, apiTools, ERROR_CODES, LATENCIES } from "./api-tools.ts";
import type { ErrorCode } from "./api-tools.ts";
import {
  SystemMenuCheckboxItem,
  SystemMenuContent,
  SystemMenuItem,
  SystemMenuLabel,
  SystemMenuRadioItem,
  SystemMenuSeparator,
  SystemMenuSubContent,
  SystemMenuSubTrigger,
  SystemMenuTrigger,
} from "./system-menu.tsx";

const NOTHING = "nothing";

const chooseLatency = (value: unknown) => apiTools.setLatency(Number(value));

const chooseFailure = (value: unknown) =>
  apiTools.setFailNext(value === NOTHING ? null : (String(value) as ErrorCode));

const short = (id: string | undefined) => (id ? `…${id.slice(-6)}` : "");

const CallItem = ({ call }: { call: ApiCallRecord }) => {
  const navigate = useNavigate();
  const { runId } = call;
  return (
    <SystemMenuItem
      className="whitespace-nowrap"
      disabled={!runId}
      onClick={() => {
        if (runId) {
          void navigate({
            to: "/activity/runs/$id",
            params: { id: runId },
          });
        }
      }}
    >
      <span className="w-8 font-mono tabular-nums">{call.status}</span>
      <span className="pl-2">{call.path}</span>
      {call.dryRun ? <span className="pl-2 opacity-60">dry run</span> : null}
      {call.forced ? <span className="pl-2 opacity-60">forced</span> : null}
      <span className="ml-auto pl-4 font-mono opacity-60">
        {call.requestId ? `req ${short(call.requestId)}` : ""}
        {runId ? ` · run ${short(runId)}` : ""}
      </span>
      <span className="w-14 pl-3 text-right tabular-nums opacity-60">
        {call.ms} ms
      </span>
    </SystemMenuItem>
  );
};

export const ApiMenu = () => {
  const tools = useSyncExternalStore(
    apiTools.subscribe,
    apiTools.read,
    apiTools.read
  );

  useEffect(() => {
    setApiDevHooks(apiDevHooks);
    return () => setApiDevHooks(undefined);
  }, []);

  return (
    <MenubarMenu>
      <SystemMenuTrigger>API</SystemMenuTrigger>
      <SystemMenuContent>
        <MenubarSub>
          <SystemMenuSubTrigger className="whitespace-nowrap">
            Recent calls
          </SystemMenuSubTrigger>
          <SystemMenuSubContent>
            <MenubarGroup>
              {tools.calls.length > 0 ? (
                tools.calls.map((call) => (
                  <CallItem key={`${call.at}-${call.path}`} call={call} />
                ))
              ) : (
                <SystemMenuLabel>No calls yet</SystemMenuLabel>
              )}
            </MenubarGroup>
            <SystemMenuSeparator />
            <SystemMenuItem onClick={() => apiTools.clear()}>
              Clear
            </SystemMenuItem>
          </SystemMenuSubContent>
        </MenubarSub>
        <SystemMenuSeparator />
        <SystemMenuCheckboxItem
          className="whitespace-nowrap"
          checked={tools.dryRun}
          onCheckedChange={(checked) => apiTools.setDryRun(checked === true)}
        >
          Send actions as dry runs
        </SystemMenuCheckboxItem>
        <MenubarSub>
          <SystemMenuSubTrigger className="whitespace-nowrap">
            Added latency
          </SystemMenuSubTrigger>
          <SystemMenuSubContent>
            <MenubarGroup>
              <MenubarRadioGroup
                value={String(tools.latency)}
                onValueChange={chooseLatency}
              >
                {LATENCIES.map((ms) => (
                  <SystemMenuRadioItem key={ms} value={String(ms)} closeOnClick>
                    {ms === 0 ? "None" : `${ms} ms`}
                  </SystemMenuRadioItem>
                ))}
              </MenubarRadioGroup>
            </MenubarGroup>
          </SystemMenuSubContent>
        </MenubarSub>
        <MenubarSub>
          <SystemMenuSubTrigger className="whitespace-nowrap">
            Fail the next call with…
          </SystemMenuSubTrigger>
          <SystemMenuSubContent>
            <MenubarGroup>
              <MenubarRadioGroup
                value={tools.failNext ?? NOTHING}
                onValueChange={chooseFailure}
              >
                <SystemMenuRadioItem value={NOTHING} closeOnClick>
                  Nothing
                </SystemMenuRadioItem>
                {ERROR_CODES.map((item) => (
                  <SystemMenuRadioItem
                    key={item.code}
                    value={item.code}
                    closeOnClick
                    className="whitespace-nowrap"
                  >
                    <span className="font-mono">{item.code}</span>
                    <span className="ml-auto pl-4 tabular-nums opacity-60">
                      {item.status}
                    </span>
                  </SystemMenuRadioItem>
                ))}
              </MenubarRadioGroup>
            </MenubarGroup>
          </SystemMenuSubContent>
        </MenubarSub>
      </SystemMenuContent>
    </MenubarMenu>
  );
};
