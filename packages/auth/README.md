# @workspace/auth

Better Auth setup, users, actors (staff, agent, integration, automation), roles and API keys.

**Status:** sign-in (P1.10; decision [0023](../../docs/decisions/0023-sign-in-with-better-auth.md)) and API keys, agents and integrations (P1.12; decision [0025](../../docs/decisions/0025-api-keys-agents-and-integrations.md)) are built. Roles are in `@workspace/actions` (P1.11).

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
- Agents and integrations call with `Authorization: Bearer fx_…`. `identityActions` (`actor.createAgent`, `actor.createIntegration`, `apiKey.create`, `apiKey.revoke`) make them; register them with the system's other actions.
- An agent can never do more than its user; an integration can do only what its roles allow.
