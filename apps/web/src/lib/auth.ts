// Sign-in with an emailed code, through Better Auth's endpoints under /auth
// (decision 0023). The session is a same-origin cookie.
import { queryOptions } from "@tanstack/react-query";

export interface Session {
  user: { id: string; name: string; email: string };
}

const authPost = async (path: string, body: unknown) => {
  const response = await fetch(`/auth${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const { message } = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    throw new Error(message ?? "Sign-in failed. Try again.");
  }
};

/** Emails a sign-in code; locally, the server prints it to its console. */
export const sendCode = (email: string) =>
  authPost("/email-otp/send-verification-otp", { email, type: "sign-in" });

export const signIn = (email: string, otp: string) =>
  authPost("/sign-in/email-otp", { email, otp });

export const signOut = () => authPost("/sign-out", {});

export const sessionQuery = queryOptions({
  queryKey: ["session"],
  queryFn: async (): Promise<Session | null> => {
    const response = await fetch("/auth/get-session", {
      credentials: "same-origin",
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as Session | null;
  },
  staleTime: 60_000,
});
