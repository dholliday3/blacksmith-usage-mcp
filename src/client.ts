/**
 * Thin HTTP client for the Blacksmith dashboard backend.
 *
 * Base URL and routes are reverse-engineered from the dashboard's axios client
 * and verified against live responses (2026-06-04):
 *   baseURL = https://dashboardbackend.blacksmith.sh/api
 *
 * Auth = the `blacksmith_session` cookie. The backend is Laravel Sanctum
 * (stateful), so the request MUST carry an `Origin`/`Referer` matching the SPA
 * or the session is ignored — verified: cookie without Origin → 401, with
 * Origin → 200. CORS does not apply server-side; Origin is purely Sanctum's
 * stateful check.
 *
 * The server rotates `blacksmith_session` on every response (rolling 14-day
 * window). We capture that Set-Cookie and write the fresh value back to the
 * keychain so the session stays alive as long as the MCP is used within ~14
 * days.
 */
import { loadSession, saveSession, type Session } from "./auth.js";

const BASE = "https://dashboardbackend.blacksmith.sh/api";
const ORIGIN = "https://app.blacksmith.sh";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

export class SessionExpiredError extends Error {
  constructor(message = "Blacksmith session is missing or expired") {
    super(message);
    this.name = "SessionExpiredError";
  }
}

export class BlacksmithClient {
  private session: Session | null = null;

  private async getSession(): Promise<Session> {
    if (!this.session) this.session = await loadSession();
    if (!this.session?.blacksmith_session) {
      throw new SessionExpiredError(
        "No Blacksmith session found. Run `pnpm login` to sign in and harvest the cookie.",
      );
    }
    return this.session;
  }

  reset(): void {
    this.session = null;
  }

  /** Persist a rotated `blacksmith_session` (and XSRF) from a response. */
  private async persistRotation(res: Response): Promise<void> {
    const setCookies =
      typeof res.headers.getSetCookie === "function"
        ? res.headers.getSetCookie()
        : [];
    if (!setCookies.length || !this.session) return;
    let changed = false;
    for (const sc of setCookies) {
      const m = /^([^=]+)=([^;]+)/.exec(sc);
      if (!m) continue;
      const [, name, value] = m;
      if (name === "blacksmith_session" && value !== this.session.blacksmith_session) {
        this.session.blacksmith_session = value!;
        changed = true;
      } else if (name === "XSRF-TOKEN") {
        this.session.xsrf = value;
        changed = true;
      } else if (name!.startsWith("remember_web_")) {
        this.session.remember_name = name;
        this.session.remember_value = value;
        changed = true;
      }
    }
    if (changed) {
      this.session.harvestedAt = new Date().toISOString();
      await saveSession(this.session).catch(() => {});
    }
  }

  async get<T>(path: string, parse: (data: unknown) => T): Promise<T> {
    const s = await this.getSession();
    const cookieParts = [`blacksmith_session=${s.blacksmith_session}`];
    if (s.xsrf) cookieParts.push(`XSRF-TOKEN=${s.xsrf}`);
    if (s.remember_name && s.remember_value) {
      cookieParts.push(`${s.remember_name}=${s.remember_value}`);
    }

    const res = await fetch(`${BASE}/${path.replace(/^\/+/, "")}`, {
      method: "GET",
      headers: {
        accept: "application/json, text/plain, */*",
        "user-agent": UA,
        origin: ORIGIN,
        referer: `${ORIGIN}/`,
        cookie: cookieParts.join("; "),
      },
    });

    if (res.status === 401 || res.status === 419) {
      this.reset();
      throw new SessionExpiredError(
        "Blacksmith returned 401/419 — the session expired. Run `pnpm login` to refresh it.",
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Blacksmith ${res.status} on /${path}: ${body.slice(0, 300)}`);
    }

    await this.persistRotation(res).catch(() => {});
    const json = (await res.json()) as unknown;
    return parse(json);
  }
}

/** ISO helpers for the date-range params the metrics endpoints expect. */
export function monthRange(monthISO?: string): { start: string; end: string } {
  // monthISO like "2026-06" or "2026-06-01"; default = current month.
  const base = monthISO ? new Date(`${monthISO.slice(0, 7)}-01T00:00:00.000Z`) : new Date();
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999));
  return { start: start.toISOString(), end: end.toISOString() };
}

/** List the last `n` month strings ("YYYY-MM"), oldest first, incl. current. */
export function lastNMonths(n: number): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** URL-builders for the reverse-engineered, verified endpoints. */
export const routes = {
  user: () => `user`,
  orgs: () => `user/github/orgs`,
  org: (org: string) => `user/github/orgs/${encodeURIComponent(org)}`,
  metricsTotal: (org: string, s: string, e: string) =>
    `${routes.org(org)}/metrics/total?start_date=${encodeURIComponent(s)}&end_date=${encodeURIComponent(e)}`,
  metricsDaily: (org: string, s: string, e: string) =>
    `${routes.org(org)}/metrics/daily?start_date=${encodeURIComponent(s)}&end_date=${encodeURIComponent(e)}`,
  metricsRepositories: (org: string, s: string, e: string) =>
    `${routes.org(org)}/metrics/repositories?start_date=${encodeURIComponent(s)}&end_date=${encodeURIComponent(e)}`,
  metricsRunnerTypes: (org: string, s: string, e: string) =>
    `${routes.org(org)}/metrics/runner-types?start_date=${encodeURIComponent(s)}&end_date=${encodeURIComponent(e)}`,
  stickyDiskTotal: (org: string, s: string, e: string) =>
    `${routes.org(org)}/metrics/docker/sticky-disk/total?start_date=${encodeURIComponent(s)}&end_date=${encodeURIComponent(e)}`,
  dockerDailyByType: (org: string, s: string, e: string) =>
    `${routes.org(org)}/metrics/docker/daily-by-type?start_date=${encodeURIComponent(s)}&end_date=${encodeURIComponent(e)}`,
  monthlyUsage: (org: string, dateISO: string) =>
    `${routes.org(org)}/usage?date=${encodeURIComponent(dateISO)}`,
  currentCoreUsage: (org: string) => `${routes.org(org)}/metrics/core-usage/current`,
  coreUsageTimeseries: (org: string, s: string, e: string, windowSize = 15) =>
    `${routes.org(org)}/metrics/core-usage/timeseries?window_size=${windowSize}&start_date=${encodeURIComponent(s)}&end_date=${encodeURIComponent(e)}`,
  hasPaymentMethod: (org: string) => `${routes.org(org)}/has-payment-method`,
  isPersonalOrg: (org: string) => `${routes.org(org)}/is-personal-org`,
};
