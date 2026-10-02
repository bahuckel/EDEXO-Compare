/**
 * "What's new" after an update (combined plan, Phase 5 [O-A]; pairs with the updater, 1.2.10).
 *
 * After the launcher's Download & Install the new copy starts with nothing saying what changed. The
 * launcher now shows, once, the notes of every release since the version whose notes the commander
 * last closed — taken from the GitHub release list the update check already reads, so a copy updated
 * by hand gets them too. Closing them saves this version (`lastSeenVersion` in the launcher prefs).
 *
 * A new install has nothing to compare with: it saves its own version at the first start and shows
 * nothing (the setup card is what it needs). An install from before this existed (no saved version,
 * but settings or a journal cache) shows this version's notes.
 */
import type { WhatsNewDTO } from "../shared/types.js";
import { APP_VERSION } from "./appVersion.js";
import { readLastSeenVersion, wasExistingInstallAtStart, writeLastSeenVersion } from "./launcherPrefs.js";
import { compareVersions, type ReleaseNotes } from "./updateCheck.js";

/**
 * Whether this start has notes to show, and from which version on (exclusive). `from` null with
 * `show` true: an existing install that never saved a version — this version's notes only.
 */
export function whatsNewRange(
  saved: string | null,
  current: string,
  existing: boolean,
): { show: boolean; from: string | null } {
  if (saved !== null) return { show: compareVersions(current, saved) > 0, from: saved };
  return { show: existing, from: null };
}

export interface WhatsNewOptions {
  /** The update checker's ask (memoised for an hour), so the release list is there. */
  check: () => Promise<unknown>;
  notesBetween: (from: string | null, to: string) => ReleaseNotes[];
  lastError: () => string | null;
  current?: string;
  readSaved?: () => string | null;
  writeSaved?: (v: string) => void;
  existing?: () => boolean;
}

export function createWhatsNew(o: WhatsNewOptions) {
  const current = o.current ?? APP_VERSION;
  const readSaved = o.readSaved ?? readLastSeenVersion;
  const writeSaved = o.writeSaved ?? writeLastSeenVersion;
  const range = whatsNewRange(readSaved(), current, (o.existing ?? wasExistingInstallAtStart)());
  let pending = range.show;
  // A new install starts with its own version seen.
  if (readSaved() === null && !range.show) {
    try {
      writeSaved(current);
    } catch {
      /* decided again next start, the same way */
    }
  }

  return {
    /**
     * The notes to show now (`pending`), or with `any` this version's notes whatever was seen — the
     * launcher's way back to them.
     */
    async get(any = false): Promise<WhatsNewDTO> {
      const show = pending || any;
      if (!show) return { pending: false, current, from: range.from, releases: [], error: null };
      await o.check().catch(() => undefined);
      const from = pending ? range.from : null;
      const releases = o.notesBetween(from, current);
      return { pending, current, from, releases, error: releases.length ? null : o.lastError() };
    },
    /** The commander closed the notes: this version is seen, nothing shows again until the next one. */
    seen(): void {
      pending = false;
      const saved = readSaved();
      if (saved === null || compareVersions(current, saved) > 0) writeSaved(current);
    },
  };
}
