/**
 * blacksmith-usage-mcp — a local MCP server exposing Blacksmith.sh usage and
 * cost APIs that Blacksmith doesn't officially publish.
 *
 * Auth: a `blacksmith_session` cookie harvested via `pnpm login` and stored in
 * the macOS Keychain. See README.md.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  BlacksmithClient,
  SessionExpiredError,
  monthRange,
  routes,
} from "./client.js";
import * as T from "./types.js";

const client = new BlacksmithClient();

/**
 * Resolve the org slug: explicit arg → BLACKSMITH_ORG env → friendly error.
 * (No hardcoded default — this tool is account-agnostic.)
 */
function resolveOrg(org?: string): string {
  const resolved = org?.trim() || process.env.BLACKSMITH_ORG?.trim();
  if (!resolved) {
    throw new Error(
      "No org specified. Pass `org`, or set BLACKSMITH_ORG. " +
        "Use `blacksmith_list_orgs` to find your GitHub org/installation slug.",
    );
  }
  return resolved;
}

const server = new McpServer({
  name: "blacksmith-usage",
  version: "0.1.0",
});

/** Wrap a handler so session-expiry surfaces as a clean, actionable message. */
function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function fail(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}
async function run(fn: () => Promise<unknown>) {
  try {
    return ok(await fn());
  } catch (e) {
    if (e instanceof SessionExpiredError) return fail(`${e.message}`);
    return fail(e instanceof Error ? e.message : String(e));
  }
}

const orgArg = {
  org: z
    .string()
    .optional()
    .describe("GitHub org/installation slug (defaults to $BLACKSMITH_ORG)"),
};
const rangeArg = {
  month: z
    .string()
    .optional()
    .describe('Billing month as "YYYY-MM" (default: current month). Selects the start/end range.'),
};

server.tool(
  "blacksmith_whoami",
  "Who the stored Blacksmith session belongs to (verifies auth is live).",
  {},
  () => run(async () => client.get(routes.user(), (d) => T.User.parse(d))),
);

server.tool(
  "blacksmith_list_orgs",
  "List GitHub orgs/installations available to the session.",
  {},
  () => run(async () => client.get(routes.orgs(), (d) => T.GithubOrgs.parse(d))),
);

server.tool(
  "blacksmith_cost_summary",
  "Headline cost for a month: total jobs, billable minutes, and dollar cost.",
  { ...orgArg, ...rangeArg },
  ({ org, month }) =>
    run(async () => {
      const o = resolveOrg(org);
      const { start, end } = monthRange(month);
      return client.get(routes.metricsTotal(o, start, end), (d) => T.MetricsTotal.parse(d));
    }),
);

server.tool(
  "blacksmith_cost_daily",
  "Per-day breakdown of jobs, minutes, and cost for a month.",
  { ...orgArg, ...rangeArg },
  ({ org, month }) =>
    run(async () => {
      const o = resolveOrg(org);
      const { start, end } = monthRange(month);
      return client.get(routes.metricsDaily(o, start, end), (d) => T.MetricsDaily.parse(d));
    }),
);

server.tool(
  "blacksmith_cost_by_repo",
  "Cost broken down by repository for a month.",
  { ...orgArg, ...rangeArg },
  ({ org, month }) =>
    run(async () => {
      const o = resolveOrg(org);
      const { start, end } = monthRange(month);
      return client.get(routes.metricsRepositories(o, start, end), (d) => T.MetricsByRepo.parse(d));
    }),
);

server.tool(
  "blacksmith_cost_by_runner",
  "Cost broken down by runner type (e.g. blacksmith-4vcpu-ubuntu-2404) for a month.",
  { ...orgArg, ...rangeArg },
  ({ org, month }) =>
    run(async () => {
      const o = resolveOrg(org);
      const { start, end } = monthRange(month);
      return client.get(routes.metricsRunnerTypes(o, start, end), (d) => T.MetricsByRunner.parse(d));
    }),
);

server.tool(
  "blacksmith_sticky_disk_cost",
  "Sticky-disk (Docker cache) storage cost and GB-hours for a month. Often the largest line item.",
  { ...orgArg, ...rangeArg },
  ({ org, month }) =>
    run(async () => {
      const o = resolveOrg(org);
      const { start, end } = monthRange(month);
      return client.get(routes.stickyDiskTotal(o, start, end), (d) => T.StickyDiskTotal.parse(d));
    }),
);

server.tool(
  "blacksmith_monthly_usage",
  "Billable vs included-free minutes for a month (free-tier headroom).",
  { ...orgArg, ...rangeArg },
  ({ org, month }) =>
    run(async () => {
      const o = resolveOrg(org);
      const { start } = monthRange(month);
      return client.get(routes.monthlyUsage(o, start), (d) => T.MonthlyUsage.parse(d));
    }),
);

server.tool(
  "blacksmith_current_vcpu",
  "Live vCPU/job usage right now, by architecture (null when idle).",
  { ...orgArg },
  ({ org }) =>
    run(async () => client.get(routes.currentCoreUsage(resolveOrg(org)), (d) => T.CoreUsageCurrent.parse(d))),
);

server.tool(
  "blacksmith_vcpu_timeseries",
  "vCPU/job usage time series for a month (windowed). Large payload.",
  { ...orgArg, ...rangeArg, window_size: z.number().int().positive().default(15) },
  ({ org, month, window_size }) =>
    run(async () => {
      const o = resolveOrg(org);
      const { start, end } = monthRange(month);
      return client.get(
        routes.coreUsageTimeseries(o, start, end, window_size),
        (d) => T.CoreUsageTimeseries.parse(d),
      );
    }),
);

server.tool(
  "blacksmith_cost_overview",
  "One-shot cost report for a month: totals, free-tier headroom, sticky-disk, and the top repos + runner types by cost.",
  { ...orgArg, ...rangeArg },
  ({ org, month }) =>
    run(async () => {
      const o = resolveOrg(org);
      const { start, end } = monthRange(month);
      const [total, usage, sticky, repos, runners] = await Promise.all([
        client.get(routes.metricsTotal(o, start, end), (d) => T.MetricsTotal.parse(d)),
        client.get(routes.monthlyUsage(o, start), (d) => T.MonthlyUsage.parse(d)),
        client.get(routes.stickyDiskTotal(o, start, end), (d) => T.StickyDiskTotal.parse(d)),
        client.get(routes.metricsRepositories(o, start, end), (d) => T.MetricsByRepo.parse(d)),
        client.get(routes.metricsRunnerTypes(o, start, end), (d) => T.MetricsByRunner.parse(d)),
      ]);
      const compute = total.total_cost;
      const cache = sticky.total_cost;
      return {
        org: o,
        month: start.slice(0, 7),
        range: { start, end },
        compute_cost_usd: compute,
        sticky_disk_cost_usd: cache,
        total_cost_usd: Math.round((compute + cache) * 100) / 100,
        total_jobs: total.total_jobs,
        billable_minutes: usage.billable_minutes,
        free_minutes: usage.free_minutes,
        free_tier_remaining_minutes: Math.max(0, usage.free_minutes - usage.billable_minutes),
        sticky_disk_gb_hours: sticky.total_gb_hours,
        cost_by_repo: [...repos].sort((a, b) => b.cost - a.cost),
        cost_by_runner: [...runners].sort((a, b) => b.cost - a.cost),
      };
    }),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("blacksmith-usage MCP server running on stdio");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
