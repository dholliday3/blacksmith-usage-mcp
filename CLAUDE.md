# CLAUDE.md

This project's working guidance for agents lives in **[AGENTS.md](./AGENTS.md)** —
read it before changing anything. End-user docs are in
[README.md](./README.md).

The three rails most expensive to break (full list + rationale in AGENTS.md):

1. **Keep the `Origin: https://app.blacksmith.sh` header** in `client.ts` — the
   Laravel/Sanctum backend returns `401` without it.
2. **Read-only only.** Never add a write tool or send `X-XSRF-TOKEN` without it
   being an explicit, surfaced decision.
3. **The session cookie is a secret** — never log, print, commit, or write it
   into the repo. It belongs only in Keychain / a `0600` file / an env var.

This is a public, account-agnostic repo: no hardcoded org, personal paths, real
org names, or real dollar figures in code or docs. Validate with `pnpm typecheck`
(CI) and `pnpm check` against a live session for any schema/endpoint change.
