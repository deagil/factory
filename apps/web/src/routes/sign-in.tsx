import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { useState } from "react";

import { sendCode, sessionQuery, signIn } from "../lib/auth.ts";

const SignIn = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      if (sent) {
        await signIn(email, code);
        // The session query isn't mounted, so invalidating wouldn't refetch.
        await queryClient.fetchQuery({ ...sessionQuery, staleTime: 0 });
        await navigate({ to: "/" });
      } else {
        await sendCode(email);
        setSent(true);
      }
      setBusy(false);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-0 flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            {sent
              ? `We sent a code to ${email}.`
              : "We will email you a code to sign in."}
          </CardDescription>
        </CardHeader>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              disabled={sent}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          {sent && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="code">Code</Label>
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </div>
          )}
          {problem && (
            <p role="alert" className="text-sm text-destructive">
              {problem}
            </p>
          )}
          <Button type="submit" disabled={busy}>
            {sent ? "Sign in" : "Send code"}
          </Button>
          {sent && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setSent(false);
                setCode("");
              }}
            >
              Use another email
            </Button>
          )}
        </form>
      </Card>
    </main>
  );
};

export const Route = createFileRoute("/sign-in")({ component: SignIn });
