# @workspace/auth

Better Auth setup, users, actors (staff, agent, integration, automation), roles and API keys.

**Status:** sign-in is built (P1.10; decision [0023](../../docs/decisions/0023-sign-in-with-better-auth.md)). Roles (P1.11) and API keys (P1.12) come next.

Design: [docs/SYSTEM_DESIGN.md](../../docs/SYSTEM_DESIGN.md), section 4.3 Identity and permissions.

```ts
const { auth, callerFrom } = createAuth({
  db,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
}); // codes print to the console unless `sendCode` is given

app.on(["GET", "POST"], "/auth/*", (c) => auth.handler(c.req.raw));
const caller = await callerFrom(request.headers); // { actorId, originUserId } or null
await pipeline.run(action, input, caller);
```

- Staff sign in with an emailed code. Only existing, active users can; there is no sign-up.
- The first sign-in creates the user's staff actor.
- Sessions travel as a cookie or `Authorization: Bearer <token>`.
