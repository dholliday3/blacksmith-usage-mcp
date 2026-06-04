/**
 * One-time (every ~14 days) interactive login.
 *
 * Opens a real Chromium window, you complete GitHub OAuth (incl. 2FA/passkey),
 * and once Blacksmith sets its session we harvest the `blacksmith_session`
 * cookie from the browser's cookie store and stash it in the macOS Keychain.
 *
 * We use a persistent profile under .auth/ (gitignored) so your GitHub session
 * sticks around — subsequent refreshes usually skip the 2FA step entirely.
 *
 *   pnpm login                 # harvests the cookie; org-agnostic
 *   BLACKSMITH_ORG=your-org pnpm login   # optional, only tags the saved session
 */
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { saveSession } from "./auth.js";

// We don't need a specific org to harvest the cookie — any authenticated page
// sets it. Land on the dashboard root, which redirects to your default org.
const ORG = process.env.BLACKSMITH_ORG;
const START_URL = "https://app.blacksmith.sh/";
const DASHBOARD_HOST = "dashboardbackend.blacksmith.sh";
const PROFILE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".auth",
  "chromium-profile",
);

async function main() {
  console.error(`Opening a browser to ${START_URL} …`);
  console.error("Complete the GitHub sign-in. This window closes automatically once the session is captured.\n");

  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(START_URL, { waitUntil: "domcontentloaded" });

  const deadline = Date.now() + 5 * 60_000; // 5 minutes to finish login
  let session: string | undefined;
  let xsrf: string | undefined;
  let rememberName: string | undefined;
  let rememberValue: string | undefined;

  while (Date.now() < deadline) {
    const cookies = await ctx.cookies();
    const bs = cookies.find(
      (c) => c.name === "blacksmith_session" && c.domain.includes(DASHBOARD_HOST),
    );
    const xs = cookies.find(
      (c) => c.name === "XSRF-TOKEN" && c.domain.includes(DASHBOARD_HOST),
    );
    const rm = cookies.find(
      (c) => c.name.startsWith("remember_web_") && c.domain.includes(DASHBOARD_HOST),
    );
    if (bs?.value) {
      // Confirm the cookie is actually authenticated by calling /api/user
      // through the page context (sends cookies automatically).
      const ok = await page
        .evaluate(async () => {
          const r = await fetch("https://dashboardbackend.blacksmith.sh/api/user", {
            credentials: "include",
            headers: { accept: "application/json" },
          });
          return r.status;
        })
        .catch(() => 0);
      if (ok === 200) {
        session = bs.value;
        xsrf = xs?.value;
        rememberName = rm?.name;
        rememberValue = rm?.value;
        break;
      }
    }
    await page.waitForTimeout(1000);
  }

  if (!session) {
    console.error("\n✗ Timed out waiting for an authenticated session. Try again.");
    await ctx.close();
    process.exit(1);
  }

  await saveSession({
    blacksmith_session: session,
    xsrf,
    remember_name: rememberName,
    remember_value: rememberValue,
    harvestedAt: new Date().toISOString(),
    org: ORG,
  });

  console.error("\n✓ Session captured and stored in the macOS Keychain (service: blacksmith-session-cookie).");
  console.error("  It is valid for ~14 days. Re-run `pnpm login` when tools start returning a session-expired error.");
  await ctx.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
