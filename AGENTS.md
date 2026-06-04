# AGENTS.md

Guidance for AI agents (and humans) working **on** this codebase. End-user docs
live in [README.md](./README.md) — read it first for what the tool does and how
auth works. This file is about contributing without breaking the things that are
easy to break.

## What this is

A small, single-purpose MCP server that replays a reverse-engineered Blacksmith
dashboard session to expose CI **usage & cost** data as read-only MCP tools.
It is unofficial: every endpoint was captured by observing the real dashboard,
not from a published spec. Treat the API as something that can change under you.

## Architecture (where things live)

```
src/
  index.ts    MCP server: registers tools, resolves org, formats output.
  client.ts   HTTP client (auth headers, cookie rotation) + route builders + monthRange().
  types.ts    Zod schemas for every response. Verified against live data 2026-06-04.
  auth.ts     Session storage abstraction (env JSON / macOS Keychain / 0600 file).
  login.ts    One-time Playwright GitHub login that harvests the cookie.
  check.ts    CLI smoke test — exercises the real client and prints a cost report.
```

Data flow: a tool in `index.ts` → `client.get(routes.X(...), schema.parse)` →
`client.ts` attaches the cookie + mandatory `Origin` header, fetches, persists
any rotated cookie, and returns parsed JSON.

## Invariants — do not break these

1. **The `Origin: https://app.blacksmith.sh` header is mandatory.** The backend
   is Laravel Sanctum (stateful); the session cookie is rejected with `401`
   without it. Verified. Don't "clean up" the headers in `client.ts`.
2. **Read-only by design.** No tool may mutate Blacksmith state. Writes would
   need the `X-XSRF-TOKEN` header, which the client deliberately never sends.
   Adding a write tool is a real product decision, not a casual change — surface
   it explicitly, don't sneak it in.
3. **The session cookie is a live credential. Never log it, print it, commit it,
   or write it into the repo.** It lives only in Keychain / a `0600` file /
   an env var. `.gitignore` blocks `.auth/` and `.session.json` — keep it that
   way. If you add debug logging, make sure it can't echo `Cookie`/`Set-Cookie`.
4. **This is a public repo — keep it account-agnostic.** No hardcoded org
   (`BLACKSMITH_ORG` / explicit arg only), no personal paths, emails, real org
   names, or real dollar figures in code or docs. There's a CI-free grep worth
   running before committing: `grep -rniE "/Users/|<your-handle>|<your-org>" src`.
5. **Schemas stay `.passthrough()`.** Endpoints are unofficial; new fields should
   surface, not throw. Don't tighten to `.strict()`.
6. **Node ≥ 20.** The client relies on global `fetch` and
   `Headers.getSetCookie()`. Don't add a fetch polyfill or drop the engines
   floor.

## Adding a new endpoint / tool

1. **Capture the real response first.** Sign in to the dashboard, open
   DevTools → Network, trigger the feature, and copy the actual request URL +
   JSON. Don't guess the shape. (For request *headers*, note the cookie +
   `Origin` pattern is already handled centrally.)
2. Add a route builder to `routes` in `client.ts`.
3. Add a Zod schema to `types.ts` (`.passthrough()`), with a comment noting the
   path it came from and that it's verified against live data.
4. Register the tool in `index.ts` via `server.tool(name, desc, argsSchema, fn)`,
   using `resolveOrg(org)` and `run(...)` so org-resolution and
   session-expiry errors are handled consistently.
5. If it's a cost signal, consider surfacing it in `blacksmith_cost_overview`
   and `check.ts` too.

## Validation

- `pnpm typecheck` — must pass. This is all CI runs (no secrets in CI).
- `pnpm check` — real end-to-end smoke test. **Requires a live session**
  (`pnpm login` first). This is the only way to confirm a schema/endpoint change
  actually matches Blacksmith's responses — typecheck can't catch a wrong shape.
- After changing `auth.ts`, verify on the relevant platform: macOS uses
  Keychain, others use the file backend. `storageLocation()` reports which.
- After changing `login.ts`, run `pnpm login` and confirm it harvests
  `blacksmith_session` (+ `remember_web_*`) and `pnpm check` then succeeds.

When you change a response schema, say plainly in your summary whether you ran
`pnpm check` against a live session or only typechecked — they are not the same
level of confidence.

## Conventions

- TypeScript strict; no `any`, no `@ts-ignore` shortcuts.
- Keep it dependency-light. This is intentionally a thin client, not a framework.
- Match the existing comment density — explain the *why* behind the unobvious
  (Sanctum, cookie rotation), not the obvious.
