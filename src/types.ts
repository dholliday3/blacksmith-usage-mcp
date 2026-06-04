/**
 * Response schemas for the Blacksmith dashboard backend.
 * All shapes verified against live responses on 2026-06-04.
 * `.passthrough()` everywhere so new fields are surfaced, never dropped.
 */
import { z } from "zod";

/** Some endpoints return billable minutes as a string; coerce to number. */
const numish = z.union([z.number(), z.string()]).pipe(z.coerce.number());

/** per-architecture core usage: { vcpus, jobs } */
export const ArchUsage = z.object({ vcpus: z.number(), jobs: z.number() });
export const ArchBreakdown = z.object({
  amd64: ArchUsage,
  arm64: ArchUsage,
  macos: ArchUsage,
});

/** GET /api/user */
export const User = z
  .object({
    id: z.number(),
    name: z.string().nullish(),
    email: z.string().nullish(),
    username: z.string().nullish(),
    github_id: z.string().nullish(),
    active_org_name: z.string().nullish(),
  })
  .passthrough();
export type User = z.infer<typeof User>;

/** GET /api/user/github/orgs → GitHub App installations */
export const GithubOrgs = z
  .object({
    total_count: z.number(),
    installations: z.array(z.record(z.unknown())),
  })
  .passthrough();
export type GithubOrgs = z.infer<typeof GithubOrgs>;

/** GET …/metrics/total → headline cost summary */
export const MetricsTotal = z
  .object({
    total_jobs: z.number(),
    total_minutes: z.number(),
    total_cost: z.number(),
  })
  .passthrough();
export type MetricsTotal = z.infer<typeof MetricsTotal>;

/** GET …/metrics/daily → per-day cost */
export const MetricsDaily = z
  .object({
    daily_metrics: z.array(
      z
        .object({
          date: z.string(),
          jobs: z.number(),
          cost: z.number(),
          minutes: z.number(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export type MetricsDaily = z.infer<typeof MetricsDaily>;

/** GET …/metrics/repositories → cost by repo (array) */
export const MetricsByRepo = z.array(
  z
    .object({
      repo_name: z.string(),
      installation_name: z.string().nullish(),
      total_billable_minutes: numish,
      runtime_minutes: z.number(),
      cost: z.number(),
    })
    .passthrough(),
);
export type MetricsByRepo = z.infer<typeof MetricsByRepo>;

/** GET …/metrics/runner-types → cost by runner type (array) */
export const MetricsByRunner = z.array(
  z
    .object({
      runner_type: z.string(),
      installation_name: z.string().nullish(),
      total_billable_minutes: numish,
      runtime_minutes: z.number(),
      cost: z.number(),
    })
    .passthrough(),
);
export type MetricsByRunner = z.infer<typeof MetricsByRunner>;

/** GET …/metrics/docker/sticky-disk/total → cache storage cost */
export const StickyDiskTotal = z
  .object({
    total_cost: z.number(),
    total_gb_hours: z.number(),
  })
  .passthrough();
export type StickyDiskTotal = z.infer<typeof StickyDiskTotal>;

/** GET …/usage?date=ISO → billable vs free minutes for the month */
export const MonthlyUsage = z
  .object({
    billable_minutes: z.number(),
    free_minutes: z.number(),
  })
  .passthrough();
export type MonthlyUsage = z.infer<typeof MonthlyUsage>;

/** GET …/metrics/core-usage/current */
export const CoreUsageCurrent = z
  .object({
    current_usage: ArchBreakdown.nullable(),
    timestamp: z.string(),
  })
  .passthrough();
export type CoreUsageCurrent = z.infer<typeof CoreUsageCurrent>;

/** GET …/metrics/core-usage/timeseries */
export const CoreUsageTimeseries = z
  .object({
    timeseries: z.array(
      z.object({ timestamp: z.string(), usage: ArchBreakdown }).passthrough(),
    ),
  })
  .passthrough();
export type CoreUsageTimeseries = z.infer<typeof CoreUsageTimeseries>;

/** Small boolean-flag endpoints. */
export const HasPaymentMethod = z
  .object({ has_payment_method: z.boolean() })
  .passthrough();
export const IsPersonalOrg = z
  .object({ is_personal_org: z.boolean() })
  .passthrough();
