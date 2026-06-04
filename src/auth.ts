/**
 * Session storage for the Blacksmith dashboard cookie.
 *
 * Auth model (reverse-engineered): the backend (dashboardbackend.blacksmith.sh)
 * is Laravel using a stateful session cookie `blacksmith_session` (httponly,
 * ~14-day rolling Max-Age). GET reads need only that cookie; XSRF is write-only,
 * which we don't do. So "the auth token" is just this one cookie value.
 *
 * Storage backends, in priority order:
 *   1. $BLACKSMITH_SESSION_JSON — the full session JSON inline (good for CI).
 *   2. macOS Keychain via `security` (default on macOS).
 *   3. A 0600 file at $BLACKSMITH_SESSION_FILE, or
 *      ${XDG_CONFIG_HOME:-~/.config}/blacksmith-usage-mcp/session.json
 *      (default on Linux/Windows, or when the env var is set).
 *
 * The cookie is a live credential — it is never written to the repo. The file
 * backend is created with owner-only permissions and lives outside any project.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const execFileP = promisify(execFile);

const KEYCHAIN_SERVICE = "blacksmith-session-cookie";
const KEYCHAIN_ACCOUNT = process.env.USER ?? "default";

export interface Session {
  /** value of the `blacksmith_session` cookie (rotates on every response) */
  blacksmith_session: string;
  /** XSRF-TOKEN cookie value (only needed if we ever add write tools) */
  xsrf?: string;
  /**
   * Laravel "remember me" cookie — the durable credential. The session cookie
   * rolls forward on activity, but if it ever lapses this re-establishes auth.
   * Stored with its full hashed name (remember_web_<hash>).
   */
  remember_name?: string;
  remember_value?: string;
  /** ISO timestamp the cookie was harvested */
  harvestedAt: string;
  /** GitHub org slug this session was harvested for (informational) */
  org?: string;
}

function useKeychain(): boolean {
  if (process.env.BLACKSMITH_SESSION_FILE) return false;
  return process.platform === "darwin";
}

function sessionFilePath(): string {
  if (process.env.BLACKSMITH_SESSION_FILE) return process.env.BLACKSMITH_SESSION_FILE;
  const base =
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(base, "blacksmith-usage-mcp", "session.json");
}

export async function saveSession(s: Session): Promise<void> {
  const payload = JSON.stringify(s);
  if (useKeychain()) {
    await execFileP("security", [
      "add-generic-password",
      "-s", KEYCHAIN_SERVICE,
      "-a", KEYCHAIN_ACCOUNT,
      "-w", payload,
      "-U",
    ]);
    return;
  }
  const file = sessionFilePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, payload, { mode: 0o600 });
  await fs.chmod(file, 0o600).catch(() => {});
}

export async function loadSession(): Promise<Session | null> {
  // Inline env override always wins (CI/headless).
  if (process.env.BLACKSMITH_SESSION_JSON) {
    try {
      return JSON.parse(process.env.BLACKSMITH_SESSION_JSON) as Session;
    } catch {
      return null;
    }
  }
  if (useKeychain()) {
    try {
      const { stdout } = await execFileP("security", [
        "find-generic-password",
        "-s", KEYCHAIN_SERVICE,
        "-a", KEYCHAIN_ACCOUNT,
        "-w",
      ]);
      const raw = stdout.trim();
      return raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      return null;
    }
  }
  try {
    const raw = await fs.readFile(sessionFilePath(), "utf8");
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  if (useKeychain()) {
    await execFileP("security", [
      "delete-generic-password",
      "-s", KEYCHAIN_SERVICE,
      "-a", KEYCHAIN_ACCOUNT,
    ]).catch(() => {});
    return;
  }
  await fs.rm(sessionFilePath(), { force: true }).catch(() => {});
}

/** Human-readable description of where the session is stored, for diagnostics. */
export function storageLocation(): string {
  if (process.env.BLACKSMITH_SESSION_JSON) return "env:BLACKSMITH_SESSION_JSON";
  if (useKeychain()) return `macOS Keychain (service: ${KEYCHAIN_SERVICE})`;
  return `file: ${sessionFilePath()}`;
}
