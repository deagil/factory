// Session: sign in as anyone, in one choice, and see the codes the server
// sent (P1b.09). Local development only, like the rest of the dev bar.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  MenubarGroup,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarSub,
} from "@workspace/ui/components/menubar";
import { useState } from "react";

import { sessionQuery } from "../lib/auth.ts";
import { readDevSession, signInAs } from "./session.ts";
import {
  SystemMenuContent,
  SystemMenuItem,
  SystemMenuLabel,
  SystemMenuRadioItem,
  SystemMenuSeparator,
  SystemMenuSubContent,
  SystemMenuSubTrigger,
  SystemMenuTrigger,
} from "./system-menu.tsx";

const time = (at: string) =>
  new Date(at).toLocaleTimeString("en-GB", { timeStyle: "medium" });

export const SessionMenu = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [problem, setProblem] = useState<string | null>(null);
  const session = useQuery(sessionQuery);
  const dev = useQuery({
    queryKey: ["dev.session"],
    queryFn: readDevSession,
    refetchInterval: 5000,
  });
  const current = session.data?.user.email ?? "";

  const choose = async (email: unknown) => {
    if (typeof email !== "string" || email === current) {
      return;
    }
    setProblem(null);
    try {
      await signInAs(email);
      queryClient.clear();
      await navigate({ to: "/" });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <MenubarMenu>
      <SystemMenuTrigger>Session</SystemMenuTrigger>
      <SystemMenuContent>
        <MenubarGroup>
          <SystemMenuLabel>Sign in as</SystemMenuLabel>
          {dev.isError ? (
            <SystemMenuLabel>{dev.error.message}</SystemMenuLabel>
          ) : null}
          <MenubarRadioGroup value={current} onValueChange={choose}>
            {dev.data?.users.map((user) => (
              <SystemMenuRadioItem
                key={user.email}
                value={user.email}
                closeOnClick
                className="whitespace-nowrap"
              >
                {user.name}
                <span className="ml-auto pl-4 opacity-60">{user.email}</span>
              </SystemMenuRadioItem>
            ))}
          </MenubarRadioGroup>
          {problem ? <SystemMenuLabel>{problem}</SystemMenuLabel> : null}
        </MenubarGroup>
        <SystemMenuSeparator />
        <MenubarSub>
          <SystemMenuSubTrigger>Sign-in codes</SystemMenuSubTrigger>
          <SystemMenuSubContent>
            <MenubarGroup>
              {dev.data?.outbox.length ? (
                dev.data.outbox.map((entry) => (
                  <SystemMenuItem
                    key={`${entry.at}-${entry.email}`}
                    onClick={() => navigator.clipboard?.writeText(entry.code)}
                  >
                    <span className="font-mono">{entry.code}</span>
                    <span className="pl-3">{entry.email}</span>
                    <span className="ml-auto pl-4 tabular-nums opacity-60">
                      {time(entry.at)}
                    </span>
                  </SystemMenuItem>
                ))
              ) : (
                <SystemMenuLabel>No codes sent yet</SystemMenuLabel>
              )}
            </MenubarGroup>
          </SystemMenuSubContent>
        </MenubarSub>
      </SystemMenuContent>
    </MenubarMenu>
  );
};
