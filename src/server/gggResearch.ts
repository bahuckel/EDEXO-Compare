/**
 * The nudge research log (owner, 2026-10-08: "We will add this only to my launcher. No need for other
 * people to be bothered by it"). On only where a file named `ggg-research.on` sits in the user folder,
 * so nobody else gets a notice or a file. Live journal lines only, never the history replay.
 *
 * Writes `edexo-ggg-research.jsonl` beside the settings, one JSON object per line:
 * - `giant`: a gas or water giant's detailed scan, the journal line as it came, with the bands its
 *   seven cloud layers sit in with and without a nudge (shared/gggNudge.ts) and whether a photo is
 *   wanted — those also come to the mail icon as a notice;
 * - `star`: every star scan, for the parent star's type, class, temperature, mass and age;
 * - `photo`: every screenshot (the journal's `Screenshot` line names the body the commander is at),
 *   matched to the giant of that name when it was logged.
 * Later the photos are sorted by eye ("looks nudged" / "looks as its temperature says") and the
 * logged values tested against that.
 */
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { bodyKey as toBodyKey } from "../shared/bodyKey.js";
import { nudgeLook, photoReason, photoText, type PhotoReason } from "../shared/gggNudge.js";

type Line = Record<string, unknown>;

export const GGG_RESEARCH_FLAG = "ggg-research.on";
export const GGG_RESEARCH_LOG = "edexo-ggg-research.jsonl";

export interface GggResearchNotice {
  bodyKey: string;
  system: string;
  systemAddress: number;
  body: string;
  title: string;
  text: string;
}

export interface GggResearch {
  /** One live journal line; true when a notice went out. */
  observe(line: Line): boolean;
  enabled(): boolean;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

const TITLE: Record<PhotoReason, string> = {
  always: "GGG research: photograph this one (nudge test)",
  maybe: "GGG research: photograph this one (nudged or not?)",
  reference: "GGG research: photograph this one (reference)",
};

export function createGggResearch(opts: {
  dir: string;
  notify: (n: GggResearchNotice, at: string) => boolean;
  now?: () => number;
}): GggResearch {
  const now = opts.now ?? Date.now;
  const flagPath = join(opts.dir, GGG_RESEARCH_FLAG);
  const logPath = join(opts.dir, GGG_RESEARCH_LOG);
  let flag: { on: boolean; at: number } | null = null;
  /** Bodies logged (by key), references wanted per class, and the logged giants by lower-case name. */
  let loaded = false;
  const logged = new Set<string>();
  const references = new Map<string, number>();
  const byName = new Map<string, { bodyKey: string; reason: PhotoReason | null }>();

  function enabled(): boolean {
    // A file check per line would be wasteful; once every 30 s is enough to switch it on or off.
    if (!flag || now() - flag.at > 30_000) flag = { on: existsSync(flagPath), at: now() };
    return flag.on;
  }

  function load(): void {
    if (loaded) return;
    loaded = true;
    try {
      if (!existsSync(logPath) || statSync(logPath).size === 0) return;
      for (const raw of readFileSync(logPath, "utf8").split("\n")) {
        if (!raw) continue;
        const r = JSON.parse(raw) as {
          type?: string;
          bodyKey?: string;
          body?: string;
          cls?: string;
          reason?: PhotoReason | null;
        };
        if (r.type !== "giant" || !r.bodyKey) continue;
        logged.add(r.bodyKey);
        if (r.body) byName.set(r.body.toLowerCase(), { bodyKey: r.bodyKey, reason: r.reason ?? null });
        if (r.reason === "reference" && r.cls) references.set(r.cls, (references.get(r.cls) ?? 0) + 1);
      }
    } catch {
      /* a broken line costs the counts, not the log */
    }
  }

  function write(row: Record<string, unknown>): void {
    try {
      appendFileSync(logPath, `${JSON.stringify(row)}\n`, "utf8");
    } catch {
      /* the research log is not worth stopping the app for */
    }
  }

  function onScan(line: Line): boolean {
    const at = str(line.timestamp) || new Date(now()).toISOString();
    if (str(line.StarType)) {
      write({ type: "star", at, line });
      return false;
    }
    const addr = num(line.SystemAddress);
    const id = num(line.BodyID);
    const look = nudgeLook({
      planetClass: str(line.PlanetClass),
      tempK: num(line.SurfaceTemperature),
      massEM: num(line.MassEM),
      radiusM: num(line.Radius),
    });
    if (!look || addr == null || id == null) return false;
    const bodyKey = toBodyKey(addr, id);
    if (logged.has(bodyKey)) return false;
    logged.add(bodyKey);
    const reason = photoReason(look, references.get(look.cls) ?? 0);
    if (reason === "reference") references.set(look.cls, (references.get(look.cls) ?? 0) + 1);
    const bodyName = str(line.BodyName);
    byName.set(bodyName.toLowerCase(), { bodyKey, reason });
    const text = reason ? photoText(look, reason) : null;
    write({
      type: "giant",
      at,
      bodyKey,
      body: bodyName,
      system: str(line.StarSystem),
      cls: look.cls,
      nudge: look.nudge,
      density: look.density,
      bandsShown: look.bandsShown,
      bandsNudged: look.bandsNudged,
      changedMin: look.changedMin,
      changedMax: look.changedMax,
      reason,
      line,
    });
    if (!reason || !text) return false;
    const system = str(line.StarSystem);
    return opts.notify(
      {
        bodyKey,
        system,
        systemAddress: addr,
        body: bodyName.startsWith(`${system} `) ? bodyName.slice(system.length + 1) : bodyName,
        title: TITLE[reason],
        text: `${bodyName}, ${str(line.PlanetClass).replace(/^Sudarsky /, "")} at ${num(line.SurfaceTemperature)} K — ${text}`,
      },
      at,
    );
  }

  function onScreenshot(line: Line): void {
    const body = str(line.Body);
    const match = body ? (byName.get(body.toLowerCase()) ?? null) : null;
    write({
      type: "photo",
      at: str(line.timestamp) || new Date(now()).toISOString(),
      file: str(line.Filename),
      system: str(line.System),
      body,
      bodyKey: match?.bodyKey ?? null,
      reason: match?.reason ?? null,
      line,
    });
  }

  return {
    enabled,
    observe(line) {
      if (line.event !== "Scan" && line.event !== "Screenshot") return false;
      if (!enabled()) return false;
      load();
      if (line.event === "Screenshot") {
        onScreenshot(line);
        return false;
      }
      if (str(line.ScanType) === "NavBeaconDetail") return false;
      return onScan(line);
    },
  };
}
