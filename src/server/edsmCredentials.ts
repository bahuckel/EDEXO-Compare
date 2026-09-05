/**
 * The commander's own EDSM account, and why the feature asks for one.
 *
 * §20.1 measured that **no API key is technically required**: every endpoint this app touches —
 * `api-system-v1/bodies`, `api-v1/systems`, `api-status-v1/elite-server` — is public, and a key is
 * only meaningful on the authenticated ones (`api-logs-v1`, `api-commander-v1`) that it never calls.
 * Sending a key to a public endpoint authenticates nothing.
 *
 * The owner still requires one to enable auto-fetch, and that is a defensible call for reasons that
 * have nothing to do with authentication:
 *
 * - **Consent with friction.** A toggle that starts sending a third party your position on every
 *   jump should cost more than one click. Going to
 *   https://www.edsm.net/en/settings/api and fetching your own key is a deliberate act.
 * - **Traffic belongs to a person.** Manual hydration is one request when a commander asks for it.
 *   Auto-fetch is a request every 20-40 seconds for hours. EDSM is a volunteer service; automated
 *   traffic at that rate should be attributable to the account benefiting from it, not to an
 *   anonymous client.
 * - **It is EDSM's own community.** The data this pulls was uploaded by registered commanders.
 *   Requiring membership to consume it automatically is the same bargain the site itself makes.
 *
 * ## Handling
 *
 * The key lives in its own file in the user data directory, **never** in
 * `edexo-compare-user-settings.json` — §21 noted that file gets pasted into bug reports — and never
 * in the repository or anywhere inside the source tree. It is never logged, never broadcast to the
 * UI, and never sent anywhere but `https://www.edsm.net` over TLS. What the UI gets back is
 * {@link EdsmCredentialsStatus}: the commander name, whether a key is present, and its last four
 * characters, which is enough to recognise "yes, that is the key I pasted" and not enough to use.
 */
import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolveEdsmCredentialsPath } from "./paths.js";

export interface EdsmCredentials {
  commanderName: string;
  apiKey: string;
}

/** What the client is allowed to know. Deliberately not the key. */
export interface EdsmCredentialsStatus {
  commanderName: string | null;
  hasKey: boolean;
  /** Last four characters, for recognition only. */
  keyHint: string | null;
}

/**
 * EDSM keys are 40-character lowercase hex, but the site has issued other shapes over the years, so
 * this checks for "a long opaque token" rather than pinning a format the service may change.
 */
const KEY_PATTERN = /^[A-Za-z0-9]{20,80}$/;

export function isPlausibleEdsmApiKey(key: string): boolean {
  return KEY_PATTERN.test(key.trim());
}

let cached: EdsmCredentials | null | undefined;

export function readEdsmCredentials(): EdsmCredentials | null {
  if (cached !== undefined) return cached;
  cached = null;
  try {
    const file = resolveEdsmCredentialsPath();
    if (!existsSync(file)) return cached;
    const j = JSON.parse(readFileSync(file, "utf8")) as Partial<EdsmCredentials>;
    const commanderName = typeof j.commanderName === "string" ? j.commanderName.trim() : "";
    const apiKey = typeof j.apiKey === "string" ? j.apiKey.trim() : "";
    if (commanderName && apiKey) cached = { commanderName, apiKey };
  } catch {
    // A corrupt credentials file means the feature is off, not that the app fails to start.
  }
  return cached;
}

export function edsmCredentialsStatus(): EdsmCredentialsStatus {
  const c = readEdsmCredentials();
  if (!c) return { commanderName: null, hasKey: false, keyHint: null };
  return { commanderName: c.commanderName, hasKey: true, keyHint: c.apiKey.slice(-4) };
}

export type SaveEdsmCredentialsResult = { ok: true } | { ok: false; error: string };

/**
 * Store the commander's key.
 *
 * Written `0600` where the platform honours it. Windows ignores the mode, but the file is inside the
 * user's own profile, which is the same protection the LAN key has had since it was introduced.
 */
export function saveEdsmCredentials(commanderName: string, apiKey: string): SaveEdsmCredentialsResult {
  const name = commanderName.trim();
  const key = apiKey.trim();
  if (!name) return { ok: false, error: "Enter the commander name your EDSM account uses." };
  if (!key) return { ok: false, error: "Enter your EDSM API key." };
  if (!isPlausibleEdsmApiKey(key)) {
    return {
      ok: false,
      error: "That does not look like an EDSM API key — copy it from edsm.net/en/settings/api.",
    };
  }

  const file = resolveEdsmCredentialsPath();
  try {
    writeFileSync(file, `${JSON.stringify({ commanderName: name, apiKey: key }, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    try {
      chmodSync(file, 0o600);
    } catch {
      /* Windows does not implement POSIX modes; the profile directory is the boundary there. */
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not write the credentials file." };
  }
  cached = { commanderName: name, apiKey: key };
  return { ok: true };
}

/** Delete the stored key. Auto-fetch has no credentials afterwards and therefore does not run. */
export function forgetEdsmCredentials(): void {
  cached = null;
  try {
    const file = resolveEdsmCredentialsPath();
    if (existsSync(file)) unlinkSync(file);
  } catch {
    /* nothing to remove */
  }
}

/** Test seam — the module caches the file, and a test that writes one needs it re-read. */
export function clearEdsmCredentialsCacheForTests(): void {
  cached = undefined;
}
