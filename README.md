# blacksmith-usage-mcp

A local [MCP](https://modelcontextprotocol.io) server that exposes
[Blacksmith.sh](https://blacksmith.sh)'s **usage & cost** data, which Blacksmith
does not officially publish as an API. It lets you pull CI spend into agents,
alerts, dashboards, or scheduled reports instead of eyeballing the web UI.

> Unofficial / unaffiliated. It replays your own authenticated dashboard
> session against Blacksmith's private backend. Endpoints may change without
> notice.

## What it gives you

Read-only tools over the metrics the dashboard itself uses:

| Tool | Returns |
|---|---|
| `blacksmith_whoami` | session identity (auth check) |
| `blacksmith_list_orgs` | your GitHub orgs/installations |
| `blacksmith_cost_summary` | jobs, minutes, **$ cost** for a month |
| `blacksmith_cost_daily` | per-day jobs / minutes / cost |
| `blacksmith_cost_by_repo` | cost per repository |
| `blacksmith_cost_by_runner` | cost per runner type |
| `blacksmith_sticky_disk_cost` | Docker-cache storage $ + GB-hours (often the biggest line item) |
| `blacksmith_sticky_disk_daily` | daily cache footprint (GB held) — the growth curve; spots an unbounded cache |
| `blacksmith_monthly_usage` | billable vs included-free minutes |
| `blacksmith_current_vcpu` | live vCPU/jobs right now |
| `blacksmith_vcpu_timeseries` | usage over time |
| `blacksmith_cost_overview` | one-shot month report (totals + free-tier headroom + top repos/runners) |
| `blacksmith_cost_trend` | month-over-month compute vs sticky-disk cost (last N months) |

Every tool takes an optional `month` (`"YYYY-MM"`, default current) and `org`
(defaults to `$BLACKSMITH_ORG`).

### Example

Ask your agent *"what's my Blacksmith spend this month?"* and
`blacksmith_cost_overview` returns:

```json
{
  "org": "your-org",
  "month": "2026-06",
  "compute_cost_usd": 2.13,
  "sticky_disk_cost_usd": 15.47,
  "total_cost_usd": 17.6,
  "total_jobs": 141,
  "billable_minutes": 1064,
  "free_minutes": 3000,
  "free_tier_remaining_minutes": 1936,
  "cost_by_repo": [{ "repo_name": "your-org/app", "cost": 2.13, "runtime_minutes": 267 }],
  "cost_by_runner": [{ "runner_type": "blacksmith-4vcpu-ubuntu-2404", "cost": 2.12, "runtime_minutes": 265 }]
}
```

Note how sticky-disk (Docker cache) storage can dwarf compute — it's frequently
the largest single line item, and the one most worth alerting on.

## How auth works

Blacksmith's dashboard (`app.blacksmith.sh`) talks to a Laravel backend at
`dashboardbackend.blacksmith.sh/api`. There is **no public API key or bearer
token** — auth is a stateful session cookie (`blacksmith_session`, httponly,
~14-day rolling). GitHub OAuth only bootstraps that cookie, and the
`code → session` exchange uses Blacksmith's server-side client secret, so the
OAuth flow can't be replayed headlessly.

So the model is: **sign in once via GitHub, harvest the cookie, replay it.** Two
non-obvious details this server handles for you:

- The backend is Laravel Sanctum (stateful), so every request sends
  `Origin: https://app.blacksmith.sh`. **Without that header the cookie is
  rejected with a 401.**
- The server rotates the session cookie on every response; the client persists
  the fresh value back to storage, so the session stays alive as long as it's
  used within ~14 days. The durable `remember_web_*` cookie is harvested too.

## Setup

```bash
git clone https://github.com/dholliday3/blacksmith-usage-mcp.git
cd blacksmith-usage-mcp
pnpm install                          # or: npm install
pnpm exec playwright install chromium # one-time, for the login helper
pnpm login                            # opens a browser; sign in with GitHub
pnpm check                            # prints a cost overview — confirms it works
```

`pnpm login` uses a persistent browser profile under `.auth/` (gitignored) so
your GitHub session sticks around and future refreshes usually skip 2FA. Re-run
`pnpm login` whenever a tool returns a "session expired" error (~every 14 days
if unused).

Set your org once so you can omit it from every call:

```bash
export BLACKSMITH_ORG=your-github-org-slug   # find it via `blacksmith_list_orgs`
```

## Register with an MCP client

Claude Code:

```bash
claude mcp add blacksmith-usage -s user -- pnpm --dir /abs/path/to/blacksmith-usage-mcp start
```

Generic `mcp.json`:

```json
{
  "mcpServers": {
    "blacksmith-usage": {
      "command": "pnpm",
      "args": ["--dir", "/abs/path/to/blacksmith-usage-mcp", "start"],
      "env": { "BLACKSMITH_ORG": "your-github-org-slug" }
    }
  }
}
```

## Where the session is stored

In priority order:

1. **`$BLACKSMITH_SESSION_JSON`** — full session JSON inline. Handy for CI /
   headless, where you inject a cookie harvested elsewhere.
2. **macOS Keychain** (`security`, service `blacksmith-session-cookie`) — default
   on macOS.
3. **A `0600` file** at `$BLACKSMITH_SESSION_FILE`, or
   `${XDG_CONFIG_HOME:-~/.config}/blacksmith-usage-mcp/session.json` — default on
   Linux/Windows, or whenever `$BLACKSMITH_SESSION_FILE` is set.

The cookie is a live credential to your Blacksmith account and is **never**
written into the repo. `.gitignore` blocks `.auth/` and any stray
`.session.json`.

## Notes

- Read-only by design — no tool mutates Blacksmith state. (Writes would require
  sending the `X-XSRF-TOKEN` header, which this client deliberately never does.)
- Schemas use `.passthrough()`, so if Blacksmith adds fields they surface rather
  than break parsing.
- Requires Node ≥ 20 (uses `fetch` + `Headers.getSetCookie`).

## Blacksmith's own LLM docs

Handy to feed an agent alongside this server (product docs, not the usage API):

- Index: <https://docs.blacksmith.sh/llms.txt>
- Full text: <https://docs.blacksmith.sh/llms-full.txt>

## License

MIT — see [LICENSE](./LICENSE).
