import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { ExoDataAlertDTO, SpeciesDatabase, SpeciesEntry } from "../shared/types.js";
import { getExoDataFixWriteRoots, getSpeciesDataDir } from "./paths.js";
import { resolveExomasteryProfileJsonPath } from "./exomasteryProfile.js";
import { expandVolcanismCriterionFragments, extractVolcanismMaterialPhrases, volcanismMaterialToCodexToken } from "../shared/volcanismMatch.js";
import { spectralKeysFromJournalStarType } from "../shared/starSpectralKeys.js";

const FIX_SCHEMA = "edexo.fix_stub.v1" as const;

export type FixStubCriteriaPatchV1 = {
  speciesEntryId: string;
  volcanismIncludesAppend?: string[];
  /** Lowercased fragments appended to {@link SpeciesCriterion.parentStarTypeIncludesAnyOf} (substring match vs journal host). */
  parentStarTypeIncludesAppend?: string[];
};

type FixStubFileV1 = {
  schema: typeof FIX_SCHEMA;
  /** Human note — added when the stub file is first created. */
  about?: string;
  targetRelative: string;
  targetKind: "codex_new_json" | "exomastery_profile_json";
  entries: {
    writtenAt: string;
    alertId: string;
    severity: string;
    detectionSource: string;
    title: string;
    detail: string;
    hints?: string;
    /** When present, runtime applies these patches when loading the species database. */
    criteriaPatch?: FixStubCriteriaPatchV1;
  }[];
};

function safeRelative(fromRoot: string, abs: string): string {
  return relative(fromRoot, abs).replace(/\\/g, "/");
}

function fixesBasenameFor(originalBasename: string): string {
  const lower = originalBasename.toLowerCase();
  if (lower.startsWith("fixes_")) return originalBasename;
  return `fixes_${originalBasename}`;
}

const EDXO_FIX_STUB_README =
  "ED-Exo Compare fix file: never overwrites the original codex JSON. Entries with criteriaPatch are applied in memory when the app loads species data so volcanism, host-star fragments, and similar tweaks take effect immediately after Fix + reload. Merge into *_new.json manually when convenient; until then, keep this fixes_*.json next to the codex file.";

function mergeFixStub(
  existing: FixStubFileV1 | null,
  targetRelative: string,
  targetKind: FixStubFileV1["targetKind"],
  entry: FixStubFileV1["entries"][0],
): FixStubFileV1 {
  const base: FixStubFileV1 =
    existing && existing.schema === FIX_SCHEMA && Array.isArray(existing.entries)
      ? {
          schema: FIX_SCHEMA,
          about: existing.about,
          targetRelative: existing.targetRelative || targetRelative,
          targetKind: existing.targetKind || targetKind,
          entries: [...existing.entries],
        }
      : {
          schema: FIX_SCHEMA,
          about: EDXO_FIX_STUB_README,
          targetRelative,
          targetKind,
          entries: [],
        };
  if (!base.about) base.about = EDXO_FIX_STUB_README;
  base.targetRelative = targetRelative;
  base.targetKind = targetKind;
  /** Avoid duplicate spam for same alert id */
  base.entries = base.entries.filter((e) => e.alertId !== entry.alertId);
  base.entries.push(entry);
  return base;
}

function writeMergedFixFile(absFixPath: string, merged: FixStubFileV1) {
  const dir = dirname(absFixPath);
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  writeFileSync(absFixPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
}

function readExistingStub(absFixPath: string): FixStubFileV1 | null {
  if (!existsSync(absFixPath)) return null;
  try {
    const j = JSON.parse(readFileSync(absFixPath, "utf8")) as FixStubFileV1;
    return j;
  } catch {
    return null;
  }
}

function resolveEntry(db: SpeciesDatabase, alert: ExoDataAlertDTO): SpeciesEntry | null {
  if (!alert.speciesEntryId) return null;
  return db.species.find((s) => s.id === alert.speciesEntryId) ?? null;
}

function starFragmentAlreadyCovered(existingFrag: string, candidate: string): boolean {
  const a = (existingFrag ?? "").trim().toLowerCase();
  const b = (candidate ?? "").trim().toLowerCase();
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function inferParentStarIncludesAppend(entry: SpeciesEntry, journalStarType: string): string[] | undefined {
  const raw = journalStarType.trim();
  if (!raw) return undefined;
  const fragments = new Set<string>();
  for (const k of spectralKeysFromJournalStarType(raw)) {
    fragments.add(k.toLowerCase());
  }
  if (/\bbrown\s+dwarf\b/i.test(raw)) {
    fragments.add("brown");
    fragments.add("dwarf");
  }
  const existing = entry.criteria.parentStarTypeIncludesAnyOf ?? [];
  const append: string[] = [];
  for (const fr of fragments) {
    if (!fr.trim()) continue;
    const already = existing.some((ex) => starFragmentAlreadyCovered(ex ?? "", fr));
    if (!already) append.push(fr);
  }
  return append.length ? append : undefined;
}

function inferJournalCriteriaPatch(entry: SpeciesEntry, alert: ExoDataAlertDTO): FixStubCriteriaPatchV1 | undefined {
  let volcanismIncludesAppend: string[] | undefined;
  const volJournal = alert.journalFixHints?.volcanism?.trim();
  if (volJournal) {
    const phrases = extractVolcanismMaterialPhrases(volJournal);
    if (phrases.length) {
      const existing = expandVolcanismCriterionFragments(entry.criteria.volcanismIncludes ?? []);
      const append: string[] = [];
      for (const ph of phrases) {
        const token = volcanismMaterialToCodexToken(ph);
        const pl = ph.toLowerCase();
        const already = existing.some((ex) => {
          const el = ex.toLowerCase();
          return el.includes(pl) || pl.includes(el) || el === token.toLowerCase();
        });
        if (!already) append.push(token);
      }
      if (append.length) volcanismIncludesAppend = append;
    }
  }

  let parentStarTypeIncludesAppend: string[] | undefined;
  const pStar = alert.journalFixHints?.parentStarType?.trim();
  if (pStar) {
    parentStarTypeIncludesAppend = inferParentStarIncludesAppend(entry, pStar);
  }

  if (!volcanismIncludesAppend?.length && !parentStarTypeIncludesAppend?.length) return undefined;
  return {
    speciesEntryId: entry.id,
    ...(volcanismIncludesAppend?.length ? { volcanismIncludesAppend } : {}),
    ...(parentStarTypeIncludesAppend?.length ? { parentStarTypeIncludesAppend } : {}),
  };
}

/**
 * Merge {@link FixStubFileV1} criteriaPatch entries into loaded species rows (same process as the server uses after editing fixes_*.json).
 */
export function applyCodexCriteriaPatchesFromFixesJson(codexJsonAbsPath: string, entries: SpeciesEntry[]): void {
  const leaf = codexJsonAbsPath.split(/[/\\]/).pop() ?? "";
  const fixPath = join(dirname(codexJsonAbsPath), fixesBasenameFor(leaf));
  if (!existsSync(fixPath)) return;
  const data = readExistingStub(fixPath);
  if (!data?.entries?.length) return;
  for (const row of data.entries) {
    const patch = row.criteriaPatch;
    if (!patch?.speciesEntryId) continue;
    const e = entries.find((s) => s.id === patch.speciesEntryId);
    if (!e) continue;
    const addVol = patch.volcanismIncludesAppend;
    if (addVol?.length) {
      if (!e.criteria.volcanismIncludes) e.criteria.volcanismIncludes = [];
      const cur = e.criteria.volcanismIncludes;
      for (const v of addVol) {
        if (!cur.some((x) => x.toLowerCase() === v.toLowerCase())) cur.push(v);
      }
    }
    const addStar = patch.parentStarTypeIncludesAppend;
    if (addStar?.length) {
      if (!e.criteria.parentStarTypeIncludesAnyOf) e.criteria.parentStarTypeIncludesAnyOf = [];
      const cur = e.criteria.parentStarTypeIncludesAnyOf;
      for (const f of addStar) {
        const fl = (f ?? "").trim().toLowerCase();
        if (!fl) continue;
        if (!cur.some((x) => starFragmentAlreadyCovered(x ?? "", fl))) cur.push(f);
      }
    }
  }
}

/**
 * Writes `fixes_<original>.json` next to the codex or exomastery profile file (never overwrites the original).
 * Mirrors to every root from {@link getExoDataFixWriteRoots} (set `EDEXO_FIX_EXTRA_SPECIES_ROOTS` for a second tree).
 */
export function writeExoDataAlertFixFiles(
  db: SpeciesDatabase,
  alert: ExoDataAlertDTO,
): { ok: boolean; written: { root: string; relativePath: string; absolutePath: string }[]; error?: string } {
  const written: { root: string; relativePath: string; absolutePath: string }[] = [];
  if (!alert.speciesEntryId || !alert.genusDataDir) {
    return { ok: false, written, error: "Alert is missing speciesEntryId or genusDataDir." };
  }
  const entry = resolveEntry(db, alert);
  if (!entry) {
    return { ok: false, written, error: `No species row for id ${alert.speciesEntryId}.` };
  }
  if (entry.genusDataDir !== alert.genusDataDir) {
    return { ok: false, written, error: "genusDataDir does not match species entry." };
  }

  const roots = getExoDataFixWriteRoots();
  const writtenAt = new Date().toISOString();
  const criteriaPatch = alert.detectionSource === "journal" ? inferJournalCriteriaPatch(entry, alert) : undefined;
  const stubEntry: FixStubFileV1["entries"][0] = {
    writtenAt,
    alertId: alert.id,
    severity: alert.severity,
    detectionSource: alert.detectionSource,
    title: alert.title,
    detail: alert.detail,
    hints: alert.fixClipboard,
    ...(criteriaPatch ? { criteriaPatch } : {}),
  };

  for (const root of roots) {
    if (alert.detectionSource === "journal") {
      const codexDir = join(getSpeciesDataDir(root), entry.genusDataDir);
      const codexName = `${entry.genusDataDir}_new.json`;
      const codexPath = join(codexDir, codexName);
      if (!existsSync(codexDir)) continue;
      if (!existsSync(codexPath)) continue;
      const fixName = fixesBasenameFor(codexName);
      const fixPath = join(codexDir, fixName);
      const targetRel = safeRelative(root, codexPath);
      const merged = mergeFixStub(readExistingStub(fixPath), targetRel, "codex_new_json", stubEntry);
      writeMergedFixFile(fixPath, merged);
      written.push({
        root,
        relativePath: safeRelative(root, fixPath),
        absolutePath: fixPath,
      });
    } else {
      const profPath = resolveExomasteryProfileJsonPath(root, entry);
      if (!profPath) continue;
      const base = profPath.split(/[/\\]/).pop() ?? "profile.json";
      const fixName = fixesBasenameFor(base);
      const fixPath = join(dirname(profPath), fixName);
      const targetRel = safeRelative(root, profPath);
      const merged = mergeFixStub(readExistingStub(fixPath), targetRel, "exomastery_profile_json", stubEntry);
      writeMergedFixFile(fixPath, merged);
      written.push({
        root,
        relativePath: safeRelative(root, fixPath),
        absolutePath: fixPath,
      });
    }
  }

  if (written.length === 0) {
    return {
      ok: false,
      written,
      error:
        alert.detectionSource === "journal"
          ? "Could not find codex JSON on disk for this genus in any configured root."
          : "Could not find exomastery profile JSON on disk for this species in any configured root.",
    };
  }

  return { ok: true, written };
}
