# Blacksmith cost model — and how to use it without a surprise bill

> **Recorded 2026-06-05**, from Blacksmith's own documentation (links at the
> bottom) plus first-hand billing data pulled through this MCP. **Blacksmith can
> change pricing and caching behavior at any time** — treat the specifics below
> as a snapshot and re-verify against the live docs before relying on them. The
> canonical, always-current source is Blacksmith's docs:
> <https://docs.blacksmith.sh/llms.txt> (index) ·
> <https://docs.blacksmith.sh/llms-full.txt> (full text).

## TL;DR

- **Compute** (runner minutes) is billed per vCPU-minute, with **3,000 free
  x64 2vCPU-minutes/month per org**.
- There are **two separate caches, billed in opposite ways**:
  - **Colocated Actions cache** — what `actions/cache` and `actions/setup-*`
    cache use. **Free** (25 GB/repo/week). Blacksmith transparently reroutes the
    standard GitHub cache actions to its own faster backend at no charge.
  - **Sticky disks** — Docker *layer* cache, `useblacksmith/stickydisk`, and
    `useblacksmith/checkout` git-cache. **$0.50/GB-month, billed continuously
    (24/7), whether or not jobs run.**
- **The only way to pay for caching is to opt into a sticky-disk action.** Use
  the plain GitHub cache actions and caching is free.

## What's free vs. billed

| You use… | Cache backend | Cost |
|---|---|---|
| `actions/cache`, `actions/cache/{save,restore}` | Blacksmith colocated | **Free** (25 GB/repo/week) |
| `actions/setup-node` (and other `setup-*`) with `cache:` | Blacksmith colocated | **Free** |
| `actions/checkout` | — (no cache) | Free |
| `docker/build-push-action` **without** `useblacksmith/setup-docker-builder` | default builder (no BK layer cache) | Free compute, no layer cache |
| **`useblacksmith/setup-docker-builder` + `useblacksmith/build-push-action`** | sticky disk | **$0.50/GB-mo** |
| **`useblacksmith/stickydisk`** | sticky disk | **$0.50/GB-mo** |
| **`useblacksmith/checkout`** (git mirror cache) | sticky disk | **$0.50/GB-mo** |
| `useblacksmith/cache` and `useblacksmith/setup-*` | (archived/deprecated) | — |

Everything in the billed rows is **opt-in** — you have to explicitly add the
`useblacksmith/*` action. Nothing routes to a sticky disk by default.

## Recipe: Blacksmith runners with $0 caching cost

1. Put **compute-bound** jobs on a Blacksmith runner
   (`runs-on: blacksmith-4vcpu-ubuntu-2404`). Best wins: lint/typecheck,
   build, unit/integration test suites, Playwright/e2e.
2. Keep `actions/checkout` and `actions/setup-node` with `cache: pnpm` (or
   `actions/cache`). These ride the **free** colocated cache automatically — no
   action swaps needed.
3. **Do not** add `useblacksmith/setup-docker-builder`,
   `useblacksmith/build-push-action` (with a builder),
   `useblacksmith/stickydisk`, or `useblacksmith/checkout`. Those are the only
   things that create a billed sticky disk.
4. For **Docker builds**, prefer keeping `docker-build` on a GitHub-hosted
   runner with `docker/build-push-action` + `cache-{from,to}: type=gha` — that
   layer cache is **free**. Moving Docker builds to Blacksmith only saves time if
   you accept either cold builds (no layer cache) or a billed sticky disk.

## The sticky-disk footgun (what actually bit us)

Blacksmith's Docker layer cache **grows unbounded by default**. Unless you set
the `max-cache-size-mb` input on `useblacksmith/setup-docker-builder`, BuildKit
never prunes, so every build's new layers accumulate forever — billed at
$0.50/GB-month, continuously.

First-hand (org `ArtisanApp`, May–Jun 2026, via this MCP's `blacksmith_cost_trend`
and `blacksmith_sticky_disk_daily`):

- Layer cache grew **122 GB → 247 GB in ~11 days** (~11 GB/day, never pruned).
- Sticky-disk was **67% of May's bill and 88% of early-June's**, projecting
  ~$90–130/mo — while compute was ~$2–14/mo and mostly inside the free tier.
- A **separate sticky disk exists per Dockerfile**, so multiple images
  accumulate in parallel.

Fixes:
- Set `max-cache-size-mb` to your working set, e.g.
  `with: { max-cache-size-mb: "30720" }` (~30 GB → ~$15/mo vs ~$125/mo
  unbounded). Pruning is LRU, so hot layers stay.
- Or don't use Blacksmith's Docker layer cache at all — build on GitHub with
  `type=gha` (free).
- Sticky disks **auto-evict after 7 days of inactivity**, so a cache stops
  billing ~7 days after you stop using it; force-delete sooner with
  `useblacksmith/stickydisk-delete`.

## Free tier, multipliers, and "free upgrades"

- **3,000 x64 2vCPU-minutes/month free per org.** Higher-vCPU runners consume the
  pool proportionally: a **4vCPU runner burns at 2×** (so ~1,500 4vCPU-min free).
  ARM `1 2vCPU-min = 0.625` x64-min; Windows `= 2×`; macOS `6vCPU = 20×`.
- **Free upgrades:** when Blacksmith has spare capacity it may bump a runner to
  the next tier (e.g. 4vCPU→8vCPU) at no extra charge.

## No hard spending cap — observe it yourself

Unlike GitHub Actions (which supports a hard $ spending limit where $0 = jobs
stop), **Blacksmith has no hard cap — only email spending alerts.** That's the
original reason this MCP exists. To stay safe:

- Set a low **Spending Alert** in the Blacksmith dashboard (early warning only,
  no enforcement).
- Watch spend with this MCP: `blacksmith_cost_trend` (month-over-month compute
  vs. sticky-disk) and `blacksmith_sticky_disk_daily` (cache growth curve). A
  scheduled run that pings on a threshold is the closest thing to a cap.

## Sources (as of 2026-06-05)

- Dependencies / Actions cache (free colocated): <https://docs.blacksmith.sh/blacksmith-caching/dependencies-actions>
- Sticky disks: <https://docs.blacksmith.sh/blacksmith-caching/dependencies-sticky-disks>
- Docker layer caching + `max-cache-size-mb`: <https://docs.blacksmith.sh/blacksmith-caching/docker-builds>
- Docker container caching: <https://docs.blacksmith.sh/blacksmith-caching/docker-container-caching>
- Git checkout caching: <https://docs.blacksmith.sh/blacksmith-caching/git-checkout-caching>
- Runners overview (free tier, runner labels): <https://docs.blacksmith.sh/blacksmith-runners/overview>
- Pricing: <https://www.blacksmith.sh/pricing>
