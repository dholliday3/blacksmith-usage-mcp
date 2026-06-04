/**
 * Smoke test: exercise the real client against the stored session and print a
 * cost overview. Run `pnpm check` after `pnpm login`.
 *
 * Org resolution: first CLI arg → $BLACKSMITH_ORG → auto-detect from your
 * installations (uses the first one and tells you the rest).
 */
import { BlacksmithClient, monthRange, routes } from "./client.js";
import { storageLocation } from "./auth.js";
import * as T from "./types.js";

async function resolveOrg(client: BlacksmithClient): Promise<string> {
  const fromArgOrEnv = process.argv[2]?.trim() || process.env.BLACKSMITH_ORG?.trim();
  if (fromArgOrEnv) return fromArgOrEnv;
  const orgs = await client.get(routes.orgs(), (d) => T.GithubOrgs.parse(d));
  const slugs = orgs.installations
    .map((i) => (i as { account?: { login?: string } }).account?.login)
    .filter((s): s is string => Boolean(s));
  if (!slugs.length) throw new Error("No installations found for this session.");
  if (slugs.length > 1) {
    console.log(`(found ${slugs.length} orgs: ${slugs.join(", ")} — using "${slugs[0]}"; pass another as an arg)`);
  }
  return slugs[0]!;
}

async function main() {
  const client = new BlacksmithClient();
  console.log(`session storage: ${storageLocation()}`);

  const user = await client.get(routes.user(), (d) => T.User.parse(d));
  console.log(`✓ Authenticated as ${user.username ?? user.email ?? user.id}`);

  const ORG = await resolveOrg(client);
  const { start, end } = monthRange();

  const total = await client.get(routes.metricsTotal(ORG, start, end), (d) => T.MetricsTotal.parse(d));
  const sticky = await client.get(routes.stickyDiskTotal(ORG, start, end), (d) => T.StickyDiskTotal.parse(d));
  const usage = await client.get(routes.monthlyUsage(ORG, start), (d) => T.MonthlyUsage.parse(d));
  const repos = await client.get(routes.metricsRepositories(ORG, start, end), (d) => T.MetricsByRepo.parse(d));

  console.log(`\n${ORG} — ${start.slice(0, 7)} month-to-date`);
  console.log(`  compute:      $${total.total_cost.toFixed(2)}  (${total.total_jobs} jobs, ${total.total_minutes} min)`);
  console.log(`  sticky-disk:  $${sticky.total_cost.toFixed(2)}  (${Math.round(sticky.total_gb_hours)} GB-hours)`);
  console.log(`  TOTAL:        $${(total.total_cost + sticky.total_cost).toFixed(2)}`);
  console.log(`  free tier:    ${usage.billable_minutes} / ${usage.free_minutes} billable minutes`);
  if (repos.length) {
    console.log(`  top repos:`);
    for (const r of [...repos].sort((a, b) => b.cost - a.cost).slice(0, 5)) {
      console.log(`    ${r.repo_name}: $${r.cost.toFixed(2)}`);
    }
  }
}

main().catch((e) => {
  console.error("✗", e instanceof Error ? e.message : e);
  process.exit(1);
});
