/**
 * "Copy diagnostics" for support (combined plan, Phase 5 [O-C]; Options → About this install).
 *
 * A tester's problem took a video call to read off their screen: which build, which journal folder,
 * whether the journal cache was used, whether LAN access was on, what the app had complained about.
 * This puts it in one block of text the commander pastes into a message.
 *
 * Nothing private goes in: the home folder is written as `~` (it carries the Windows user name), the
 * commander name is replaced, LAN links are left out (they carry the access key) and any `k=` key
 * that reaches a logged line is masked. No EDSM or Canonn credentials are read here at all.
 */
import os from "node:os";

/** One warning or error the app printed, for the last lines of the report. */
export interface LoggedLine {
  at: string;
  level: "warn" | "error";
  text: string;
}

const RING_MAX = 25;
const ring: LoggedLine[] = [];
let installed = false;

function lineText(args: unknown[]): string {
  return args
    .map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === "string" ? a : safeJson(a)))
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 300);
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

/**
 * Keep the last warnings and errors the app prints, for the report. The console still prints them
 * as before. Once per process.
 */
export function installLogRing(): void {
  if (installed) return;
  installed = true;
  for (const level of ["warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      try {
        ring.push({ at: new Date().toISOString(), level, text: lineText(args) });
        if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
      } catch {
        /* the report never breaks the console */
      }
      original(...args);
    };
  }
}

export function loggedLines(): LoggedLine[] {
  return ring.slice();
}

/** Home folder → `~`, the commander's name → `CMDR`, any access key → `k=…`. */
export function redact(text: string, o: { home?: string; commander?: string | null } = {}): string {
  let t = text;
  const home = o.home ?? os.homedir();
  if (home && home.length > 3) {
    const esc = home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Either slash: a Windows path can come back with forward ones.
    t = t.replace(new RegExp(esc.replace(/\\\\/g, "[\\\\/]"), "gi"), "~");
  }
  const cmdr = o.commander?.trim();
  if (cmdr && cmdr.length > 1) {
    t = t.replace(new RegExp(cmdr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "CMDR");
  }
  return t.replace(/([?&]k=)[^&\s"']+/gi, "$1…");
}

export interface DiagnosticsInput {
  now: Date;
  version: string;
  /** portable | zip | appimage, or "source" for a run from the repository. */
  form: string;
  electron: string | null;
  node: string;
  platform: string;
  osRelease: string;
  arch: string;
  memGb: number;
  journalDir: string;
  journalDirOk: boolean;
  /** True when the folder is the one the commander chose rather than the game's default. */
  journalDirChosen: boolean;
  journalFiles: number;
  currentJournal: string | null;
  historyPreset: string;
  lastEventIso: string | null;
  /** The last journal boot: which path (cache / full) and its timings. */
  boot: { path: string; summary: string; at: string } | null;
  booting: string | null;
  /** "server" when it listens on the network, "client" when on this PC only (AppStatusDTO.mode). */
  mode: string;
  port: number;
  bindHost: string;
  lanAccess: { saved: boolean; active: boolean } | null;
  gameRunning: boolean | null;
  uploads: { edsmFetch: boolean; edsmUpload: boolean; canonn: boolean; eddn: boolean };
  update: {
    latest: string | null;
    checkedAt: string | null;
    error: string | null;
    download: string | null;
  };
  speciesCount: number;
  speciesDataWarnings: number;
  commander: string | null;
  log: LoggedLine[];
}

const onOff = (b: boolean) => (b ? "on" : "off");

/** The report, as plain text ready to paste (a fenced block keeps Discord and GitHub from reflowing it). */
export function buildDiagnosticsText(d: DiagnosticsInput, home?: string): string {
  const lines: string[] = [];
  lines.push(
    `ED Exo Compare ${d.version} — diagnostics, ${d.now.toISOString().replace("T", " ").slice(0, 16)} UTC`,
  );
  lines.push(
    `Build: ${d.form}${d.electron ? `, Electron ${d.electron}` : ""}, Node ${d.node}`,
    `System: ${d.platform} ${d.osRelease} ${d.arch}, ${d.memGb} GB memory`,
    `Journal folder: ${d.journalDirOk ? "found" : "NOT FOUND"} (${d.journalDirChosen ? "chosen" : "default"}) ${d.journalDir}`,
    `Journals: ${d.journalFiles} merged, history ${d.historyPreset}, current ${d.currentJournal ?? "none"}`,
    `Last journal event: ${d.lastEventIso ?? "none"}`,
  );
  if (d.booting) lines.push(`Journal start: still running (${d.booting})`);
  else if (d.boot)
    lines.push(`Journal start (${d.boot.path}, ${d.boot.at.slice(11, 19)} UTC): ${d.boot.summary}`);
  else lines.push("Journal start: not reported");
  lines.push(
    `Server: ${d.mode === "server" ? "on the network" : "this PC only"}, ${d.bindHost}:${d.port}, LAN access ${
      d.lanAccess
        ? `${onOff(d.lanAccess.active)}${d.lanAccess.saved !== d.lanAccess.active ? ` (${onOff(d.lanAccess.saved)} after a restart)` : ""}`
        : "set on the command line"
    }`,
    `Elite running: ${d.gameRunning === null ? "unknown" : d.gameRunning ? "yes" : "no"}`,
    `Uploads: EDSM fetch ${onOff(d.uploads.edsmFetch)}, EDSM upload ${onOff(d.uploads.edsmUpload)}, Canonn ${onOff(d.uploads.canonn)}, EDDN ${onOff(d.uploads.eddn)}`,
    `Update: latest ${d.update.latest ?? "unknown"}${d.update.checkedAt ? ` (asked ${d.update.checkedAt.slice(0, 16).replace("T", " ")})` : ""}${
      d.update.error ? `, error: ${d.update.error}` : ""
    }${d.update.download ? `, download ${d.update.download}` : ""}`,
    `Species data: ${d.speciesCount} species${d.speciesDataWarnings ? `, ${d.speciesDataWarnings} warning(s)` : ""}`,
  );
  if (d.log.length) {
    lines.push(`Last ${d.log.length} warning(s) / error(s):`);
    for (const l of d.log)
      lines.push(
        `  ${l.at.slice(5, 19).replace("T", " ")} ${l.level === "error" ? "ERR " : "warn"} ${l.text}`,
      );
  } else {
    lines.push("No warnings or errors since start.");
  }
  return "```\n" + redact(lines.join("\n"), { home, commander: d.commander }) + "\n```\n";
}
