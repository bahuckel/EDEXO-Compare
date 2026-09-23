/**
 * Species precision, phase 0: are the labels right before anything is measured on them?
 *
 *   npx tsx scripts/precision-phase0.ts [capture.jsonl]
 *
 * The plan (`docs/species-precision-plan-20260923.md`) hunts for what separates two species of one
 * genus — down to a fraction of a percent of one crust material. A separator found on mislabelled
 * rows is a separator between two labelling errors, and 2026-09-23 showed how cheaply that happens:
 * a collector's hand-typed Tussock list, one place off, "proved" a seven-cycle in a correct index.
 * So nothing is measured until every source has been checked against the one source that cannot be
 * wrong about a name: the game client, writing `Species_Localised` into the commander's own journals.
 *
 * ## Sources, and what each is trusted for
 *
 *  - **journal** — `ScanOrganic` `Log`/`Sample` (never `Analyse`, which can fire at a different body
 *    once the commander flies off) and `CodexEntry` in `Organic_Structures`, each with the token,
 *    the game's localised name and colour, and the body's full `Scan`. Gold.
 *  - **corpus** — `exomastery-feeder/data/raw/planets/<species>/`, Spansh records with full physics.
 *    Labelled by Spansh; checked here against the journal wherever both know a body.
 *  - **capture** — an EDDN collector export. Its `name` fields are the collector's table, never the
 *    game's (EDDN strips `_Localised`), so species come from the **token**, through a map built from
 *    the journal first and the collector's table only for tokens the journal has never seen — and that
 *    table is itself checked against the journal before it is used.
 *
 * ## Checks
 *
 *   C1  journal: every token carries exactly one name
 *   C2  collector table: agrees with the journal on every token both know
 *   C3  one species per genus per body, within each source — two is a label error, not biology
 *   C4  cross-source: journal ↔ corpus, journal ↔ capture, corpus ↔ capture, per body and genus
 *   C5  every label resolves to exactly one species in the tree
 *   C6  colour: the app's colour rule against the game's colour (journal), and every variant token
 *       the capture carries against the rule tables (coverage)
 *
 * ## Joining bodies
 *
 * On the full body name, lower-cased. Not on id64: the corpus packs store it as a JSON number, and
 * ids above 2^53 come back rounded — `252201698486368700` is not the id that body has. A name is
 * exact in every source.
 *
 * ## Output — local only
 *
 * `docs/precision/` (gitignored): `phase0-report.md`, and `truth-table.jsonl`, one row per body and
 * genus with the agreed species, every source that saw it, and each source's raw physics for phase 1.
 * The truth table holds rows from the commander's journals and never leaves this machine.
 */
import path from "node:path";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { gunzipSync } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { listJournalFilesChronological, readJournalFull } from "../src/server/journalWatcher.js";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { findSpeciesEntryForLabel } from "../src/feeder/install.js";
import { colourVariantRuleFor } from "../src/server/eddsnColourVariants.js";
import { resolveColourVariant } from "../src/shared/colourVariants.js";
import { spectralKeysFromJournalStarType } from "../src/shared/starSpectralKeys.js";
import type { JournalLine, SpeciesEntry } from "../src/shared/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const feederDir = process.env.EXOMASTERY_FEEDER_DIR?.trim() || path.resolve(root, "..", "exomastery-feeder");
const collectorDir = process.env.EDDN_COLLECTOR_DIR?.trim() || path.resolve(root, "..", "eddn-bio-collector");
const journalDir =
  process.env.ED_JOURNAL_DIR?.trim() ||
  path.join(process.env.USERPROFILE || "", "Saved Games", "Frontier Developments", "Elite Dangerous");
const outDir = path.join(root, "docs", "precision");

const db = loadSpeciesDatabaseFromTree(root);
const clean = (v: unknown): string => String(v ?? "").trim();
const bodyKeyOf = (name: string) => name.trim().toLowerCase();

type Source = "journal" | "corpus" | "capture";

/* ------------------------------------------------------------------ tokens */

/**
 * `$Codex_Ent_Tussocks_11_F_Name;` → species key `Tussocks_11`, variant `F`.
 * A token with no two-digit species number (`$Codex_Ent_Seed_Name;`) is its own key.
 */
function parseToken(token: string): { key: string; variant: string | null } | null {
  const m = /^\$Codex_Ent_(.+)_Name;$/i.exec(token.trim());
  if (!m) return null;
  const parts = m[1]!.split("_");
  const idx = parts.findIndex((p) => /^\d{2}$/.test(p));
  if (idx <= 0) return { key: m[1]!, variant: null };
  return { key: parts.slice(0, idx + 1).join("_"), variant: parts.slice(idx + 1).join("_") || null };
}

/** "Tussock Caputus - Yellow" → ["Tussock Caputus", "Yellow"]. */
function splitColour(localised: string): [string, string | null] {
  const i = localised.lastIndexOf(" - ");
  return i < 0 ? [localised.trim(), null] : [localised.slice(0, i).trim(), localised.slice(i + 3).trim() || null];
}

/* ------------------------------------------------------------------ labels → tree */

const unresolved = new Map<string, { sources: Set<Source>; n: number }>();
const resolveCache = new Map<string, SpeciesEntry | null>();
function resolve(label: string, source: Source): SpeciesEntry | null {
  const k = label.toLowerCase();
  let e = resolveCache.get(k);
  if (e === undefined) {
    e = findSpeciesEntryForLabel(db, label);
    resolveCache.set(k, e);
  }
  if (!e) {
    const u = unresolved.get(label) ?? { sources: new Set<Source>(), n: 0 };
    u.sources.add(source);
    u.n += 1;
    unresolved.set(label, u);
  }
  return e;
}

/* ------------------------------------------------------------------ the claims */

interface Claim {
  source: Source;
  bodyKey: string;
  bodyName: string;
  label: string;
  entry: SpeciesEntry | null;
  /** Genus key: the tree's `genusDataDir` when resolved, else the label's first word. */
  genus: string;
  /** The game's colour name — journal only. */
  colour: string | null;
  /** Variant suffix of the token — journal and capture. */
  variantToken: string | null;
  speciesToken: string | null;
}

const claims: Claim[] = [];
function claim(c: Omit<Claim, "genus" | "entry">): void {
  const entry = resolve(c.label, c.source);
  const genus = entry?.genusDataDir ?? c.label.split(/\s+/)[0]!.toLowerCase();
  claims.push({ ...c, entry, genus });
}

/* ------------------------------------------------------------------ 1. the journals */

interface JBody {
  name: string;
  scan: Record<string, unknown>;
}
const jBodies = new Map<string, JBody>(); // `${SystemAddress}:${BodyID}`
const jStars = new Map<string, string>(); // `${SystemAddress}:${BodyID}` → StarType
/** token key → game names seen, with counts: C1. */
const journalNames = new Map<string, Map<string, number>>();
const pendingJournal: { sysBody: string; label: string; colour: string | null; token: string; variant: string | null }[] = [];
const journalCounts = { scanOrganic: 0, analyseSkipped: 0, codex: 0, codexNotOrganic: 0 };

function noteName(key: string, name: string): void {
  const m = journalNames.get(key) ?? new Map<string, number>();
  m.set(name, (m.get(name) ?? 0) + 1);
  journalNames.set(key, m);
}

function onJournal(line: JournalLine): void {
  const ev = line.event;
  if (ev === "Scan") {
    const k = `${String(line.SystemAddress)}:${String(line.BodyID)}`;
    if (clean(line.StarType)) jStars.set(k, clean(line.StarType));
    if (clean(line.PlanetClass)) jBodies.set(k, { name: clean(line.BodyName), scan: line as Record<string, unknown> });
    return;
  }
  if (ev === "ScanOrganic") {
    const type = clean(line.ScanType);
    if (type === "Analyse") {
      journalCounts.analyseSkipped += 1;
      return;
    }
    if (type !== "Log" && type !== "Sample") return;
    journalCounts.scanOrganic += 1;
    const species = parseToken(clean(line.Species));
    const label = clean(line.Species_Localised);
    if (!species || !label) return;
    noteName(species.key, label);
    const variant = parseToken(clean(line.Variant));
    pendingJournal.push({
      sysBody: `${String(line.SystemAddress)}:${String(line.Body)}`,
      label,
      colour: splitColour(clean(line.Variant_Localised))[1],
      token: species.key,
      variant: variant?.variant ?? null,
    });
    return;
  }
  if (ev === "CodexEntry") {
    if (!/Organic_Structures/i.test(clean(line.SubCategory))) {
      if (/Biology/i.test(clean(line.Category))) journalCounts.codexNotOrganic += 1;
      return;
    }
    journalCounts.codex += 1;
    const t = parseToken(clean(line.Name));
    const [label, colour] = splitColour(clean(line.Name_Localised));
    if (!t || !label || line.BodyID == null) return;
    noteName(t.key, label);
    pendingJournal.push({
      sysBody: `${String(line.SystemAddress)}:${String(line.BodyID)}`,
      label,
      colour,
      token: t.key,
      variant: t.variant,
    });
  }
}

let journalFiles = 0;
if (existsSync(journalDir)) {
  const files = await listJournalFilesChronological(journalDir, { minFileStartUtcMs: 0 });
  journalFiles = files.length;
  for (const f of files) await readJournalFull(f, onJournal);
}

/** Host star class for a journal body: the nearest `Star` in `Parents`. Null when it orbits a barycentre. */
function journalHostStar(sysBody: string, scan: Record<string, unknown>): string | null {
  const sys = sysBody.split(":")[0]!;
  for (const p of (scan.Parents as Record<string, number>[] | undefined) ?? []) {
    if (typeof p?.Star === "number") return jStars.get(`${sys}:${p.Star}`) ?? null;
    if (typeof p?.Null === "number") return null;
  }
  return null;
}

const journalPhysics = new Map<string, { scan: Record<string, unknown>; hostStar: string | null }>();
let journalNoScan = 0;
for (const p of pendingJournal) {
  const b = jBodies.get(p.sysBody);
  if (!b) {
    journalNoScan += 1;
    continue;
  }
  const bodyKey = bodyKeyOf(b.name);
  journalPhysics.set(bodyKey, { scan: b.scan, hostStar: journalHostStar(p.sysBody, b.scan) });
  claim({
    source: "journal",
    bodyKey,
    bodyName: b.name,
    label: p.label,
    colour: p.colour,
    variantToken: p.variant,
    speciesToken: p.token,
  });
}

/* ------------------------------------------------------------------ 2. the collector's table (C2) */

/** token key → name, the journal's where it has one. */
const tokenName = new Map<string, string>();
for (const [key, names] of journalNames) {
  const top = [...names].sort((a, b) => b[1] - a[1])[0];
  if (top) tokenName.set(key, top[0]);
}
const collectorCheck = { agree: 0, disagree: [] as string[], collectorOnly: 0, available: false };
const collectorCodex = path.join(collectorDir, "src", "codex.ts");
if (existsSync(collectorCodex)) {
  const mod = (await import(pathToFileURL(collectorCodex).href)) as {
    SPECIES_BY_STEM: Record<string, string[]>;
    GENUS_BY_STEM: Record<string, string>;
  };
  collectorCheck.available = true;
  for (const [stem, list] of Object.entries(mod.SPECIES_BY_STEM)) {
    const genus = mod.GENUS_BY_STEM[stem] ?? stem;
    list.forEach((sp, i) => {
      const key = `${stem}_${String(i + 1).padStart(2, "0")}`;
      const theirs = `${genus} ${sp}`;
      const ours = tokenName.get(key);
      if (ours == null) {
        collectorCheck.collectorOnly += 1;
        tokenName.set(key, theirs);
      } else if (ours.toLowerCase() === theirs.toLowerCase()) collectorCheck.agree += 1;
      else collectorCheck.disagree.push(`${key}: game "${ours}", collector "${theirs}"`);
    });
  }
}

/* ------------------------------------------------------------------ 3. the corpus */

interface CacheBody {
  name?: string;
  bodyId?: number;
  [k: string]: unknown;
}
interface PackDoc {
  systemName?: string;
  bodyName?: string;
  speciesLabel?: string;
  systemCacheFile?: string;
}

const systemCache = new Map<string, CacheBody[]>();
function bodiesOfSystemCache(file: string): CacheBody[] {
  const hit = systemCache.get(file);
  if (hit) return hit;
  let list: CacheBody[] = [];
  try {
    const j = JSON.parse(readFileSync(path.join(feederDir, "data", "raw", "systems", file), "utf8")) as {
      bodies?: CacheBody[];
    };
    list = Array.isArray(j.bodies) ? j.bodies : [];
  } catch {
    list = [];
  }
  systemCache.set(file, list);
  return list;
}

const corpusPhysics = new Map<string, { body: CacheBody; systemCacheFile: string }>();
const corpusCounts = { folders: 0, docs: 0, bodies: 0, noCache: 0 };
const planetsDir = path.join(feederDir, "data", "raw", "planets");
if (existsSync(planetsDir)) {
  for (const folder of readdirSync(planetsDir)) {
    const dir = path.join(planetsDir, folder);
    corpusCounts.folders += 1;
    /*
      The same record under three spellings — body_*.json, sample_*.json and samples.jsonl.gz — and
      reading only one of them once reported 430 bodies for a species with more than 800. All three,
      de-duplicated on the body name.
    */
    const docs: PackDoc[] = [];
    for (const f of readdirSync(dir)) {
      const full = path.join(dir, f);
      try {
        if (f.endsWith(".jsonl.gz")) {
          for (const line of gunzipSync(readFileSync(full)).toString("utf8").split(/\r?\n/)) {
            if (line.trim()) docs.push(JSON.parse(line) as PackDoc);
          }
        } else if (f.endsWith(".json")) docs.push(JSON.parse(readFileSync(full, "utf8")) as PackDoc);
      } catch {
        /* one bad pack does not lose the rest */
      }
    }
    corpusCounts.docs += docs.length;
    const seen = new Set<string>();
    for (const d of docs) {
      const name = clean(d.bodyName);
      const label = clean(d.speciesLabel);
      if (!name || !label || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      const cacheFile = clean(d.systemCacheFile);
      const body = cacheFile ? bodiesOfSystemCache(cacheFile).find((b) => clean(b.name) === name) : undefined;
      if (!body) corpusCounts.noCache += 1;
      else corpusPhysics.set(bodyKeyOf(name), { body, systemCacheFile: cacheFile });
      claim({
        source: "corpus",
        bodyKey: bodyKeyOf(name),
        bodyName: name,
        label,
        colour: null,
        variantToken: null,
        speciesToken: null,
      });
    }
  }
  corpusCounts.bodies = corpusPhysics.size;
}

/* ------------------------------------------------------------------ 4. the capture */

function newestCapture(): string | null {
  const dir = path.join(root, "docs");
  const hits = existsSync(dir) ? readdirSync(dir).filter((f) => /^eddn-bio-.*\.jsonl$/.test(f)).sort() : [];
  return hits.length ? path.join(dir, hits[hits.length - 1]!) : null;
}
const capturePath = process.argv[2] ? path.resolve(process.argv[2]) : newestCapture();
const capturePhysics = new Map<string, Record<string, unknown>>();
const captureCounts = { bodies: 0, withBio: 0, analyseSkipped: 0, unnamedToken: new Map<string, number>() };
const captureStars = new Map<string, Record<string, unknown>>(); // body id64 string → star row

if (capturePath && existsSync(capturePath)) {
  const rows: Record<string, unknown>[] = [];
  const rl = createInterface({ input: createReadStream(capturePath), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.includes('"kind":"body"')) continue;
    // id64 fields are decimal strings in this contract, so a plain parse keeps them exact.
    const o = JSON.parse(line) as Record<string, unknown>;
    if (clean(o.type).toLowerCase() === "star") captureStars.set(clean(o.id64), o);
    rows.push(o);
  }
  for (const o of rows) {
    captureCounts.bodies += 1;
    const sig = (o.signals ?? {}) as { organics?: Record<string, unknown>[]; codex?: Record<string, unknown>[] };
    const tokens: { species: string; variant: string | null }[] = [];
    for (const s of sig.organics ?? []) {
      const t = clean(s.scanType);
      if (t === "Analyse") {
        captureCounts.analyseSkipped += 1;
        continue;
      }
      if (t !== "Log" && t !== "Sample") continue;
      const sp = parseToken(clean(s.species));
      const va = parseToken(clean(s.variant));
      if (sp) tokens.push({ species: sp.key, variant: va?.variant ?? null });
    }
    for (const c of sig.codex ?? []) {
      if (!/Organic_Structures/i.test(clean(c.subCategory))) continue;
      const t = parseToken(clean(c.token));
      if (t) tokens.push({ species: t.key, variant: t.variant });
    }
    if (!tokens.length) continue;
    captureCounts.withBio += 1;
    // 116 bodies in the first capture carry no name. Kept under their id so they still count as
    // truth, but they can never join another source — an empty key would merge them all into one.
    const name = clean(o.name) || `id64:${clean(o.id64)}`;
    capturePhysics.set(bodyKeyOf(name), o);
    const seen = new Set<string>();
    for (const t of tokens) {
      if (seen.has(`${t.species}|${t.variant}`)) continue;
      seen.add(`${t.species}|${t.variant}`);
      const label = tokenName.get(t.species);
      if (!label) {
        captureCounts.unnamedToken.set(t.species, (captureCounts.unnamedToken.get(t.species) ?? 0) + 1);
        continue;
      }
      claim({
        source: "capture",
        bodyKey: bodyKeyOf(name),
        bodyName: name,
        label,
        colour: null,
        variantToken: t.variant,
        speciesToken: t.species,
      });
    }
  }
}

/* ------------------------------------------------------------------ C1, C3, C4, C5 */

const c1 = [...journalNames].filter(([, names]) => names.size > 1);

/** bodyKey → source → genus → set of species ids (or labels, unresolved). */
const byBody = new Map<string, Map<Source, Map<string, Set<string>>>>();
const bodyName = new Map<string, string>();
for (const c of claims) {
  bodyName.set(c.bodyKey, c.bodyName);
  const s = byBody.get(c.bodyKey) ?? new Map<Source, Map<string, Set<string>>>();
  byBody.set(c.bodyKey, s);
  const g = s.get(c.source) ?? new Map<string, Set<string>>();
  s.set(c.source, g);
  const set = g.get(c.genus) ?? new Set<string>();
  g.set(c.genus, set);
  set.add(c.entry?.id ?? `?${c.label}`);
}

const SOURCES: Source[] = ["journal", "corpus", "capture"];
const c3: Record<Source, string[]> = { journal: [], corpus: [], capture: [] };
for (const [bk, perSource] of byBody) {
  for (const [src, genera] of perSource) {
    for (const [genus, set] of genera) {
      if (set.size > 1) c3[src].push(`${bodyName.get(bk)} — ${genus}: ${[...set].join(", ")}`);
    }
  }
}

interface PairResult {
  bodies: number;
  slots: number;
  agree: number;
  disagree: string[];
}
function comparePair(a: Source, b: Source): PairResult {
  const r: PairResult = { bodies: 0, slots: 0, agree: 0, disagree: [] };
  for (const [bk, perSource] of byBody) {
    const ga = perSource.get(a);
    const gb = perSource.get(b);
    if (!ga || !gb) continue;
    r.bodies += 1;
    for (const [genus, sa] of ga) {
      const sb = gb.get(genus);
      if (!sb) continue;
      r.slots += 1;
      const same = sa.size === sb.size && [...sa].every((x) => sb.has(x));
      if (same) r.agree += 1;
      else r.disagree.push(`${bodyName.get(bk)} — ${genus}: ${a} ${[...sa].join("/")} · ${b} ${[...sb].join("/")}`);
    }
  }
  return r;
}
const c4 = {
  "journal ↔ corpus": comparePair("journal", "corpus"),
  "journal ↔ capture": comparePair("journal", "capture"),
  "corpus ↔ capture": comparePair("corpus", "capture"),
};

/* ------------------------------------------------------------------ C6 colour */

const colour = {
  journal: { right: 0, amongCandidates: 0, wrong: [] as string[], noRule: new Set<string>(), undecided: 0, noHost: 0 },
  capture: {
    covered: 0,
    notInTable: new Map<string, number>(),
    hostAgrees: 0,
    hostDisagrees: [] as string[],
    hostUnknown: 0,
    /** `host Y → token F`: which star the colour followed instead, counted. */
    pairs: new Map<string, number>(),
    /** Per host class: how often its planets' colour follows it. */
    byHost: new Map<string, { agree: number; disagree: number }>(),
  },
};

/**
 * Every class key a capture star answers to. The capture writes `spectralClass` with the subclass
 * (`K2`, `DAB5`), where the journal and the variant token write the bare class — so the digits go
 * before the journal's own key expansion is asked, and the bare letters are kept as well.
 */
function starKeys(spectral: string): Set<string> {
  const bare = spectral.trim().replace(/\d.*$/, "");
  const keys = new Set<string>([bare.toUpperCase()]);
  for (const k of spectralKeysFromJournalStarType(bare)) keys.add(k.toUpperCase());
  return keys;
}

function captureHostClass(o: Record<string, unknown>): string | null {
  const star = captureStars.get(clean(o.hostStarBodyId64));
  if (!star) return null;
  return clean(star.spectralClass) || clean(star.subType) || null;
}

for (const c of claims) {
  if (!c.entry) continue;
  const rule = colourVariantRuleFor(root, c.entry.genusDataDir, c.entry.displayName);
  if (c.source === "journal" && c.colour) {
    if (!rule) {
      colour.journal.noRule.add(c.entry.displayName);
      continue;
    }
    const phys = journalPhysics.get(c.bodyKey);
    const scan = phys?.scan ?? {};
    const host = phys?.hostStar ?? null;
    if (rule.source === "star" && !host) {
      colour.journal.noHost += 1;
      continue;
    }
    const ans = resolveColourVariant(rule, {
      parentStarType: host,
      materials: (scan.Materials as { Name?: string; Percent?: number }[] | undefined) ?? [],
    });
    const want = c.colour.toLowerCase();
    if (ans.colour?.toLowerCase() === want) colour.journal.right += 1;
    else if (ans.candidates.some((x) => x.toLowerCase() === want)) colour.journal.amongCandidates += 1;
    else if (!ans.candidates.length) colour.journal.undecided += 1;
    else
      colour.journal.wrong.push(
        `${c.bodyName} — ${c.entry.displayName}: game ${c.colour}, app ${ans.candidates.join(" or ")} (${rule.source}${host ? `, host ${host}` : ""})`,
      );
  }
  if (c.source === "capture" && c.variantToken && rule) {
    const v = c.variantToken;
    const key = rule.source === "material" ? v.toLowerCase() : v.toUpperCase();
    if (rule.map[key]) colour.capture.covered += 1;
    else {
      const k = `${c.entry.displayName} [${rule.source}] ${v}`;
      colour.capture.notInTable.set(k, (colour.capture.notInTable.get(k) ?? 0) + 1);
    }
    if (rule.source === "star") {
      const host = captureHostClass(capturePhysics.get(c.bodyKey) ?? {});
      if (!host) colour.capture.hostUnknown += 1;
      else if (starKeys(host).has(v.toUpperCase())) colour.capture.hostAgrees += 1;
      else {
        colour.capture.hostDisagrees.push(`${c.bodyName} — ${c.entry.displayName}: token ${v}, host star ${host}`);
        const pair = `host ${host.replace(/\d.*$/, "")} → token ${v}`;
        colour.capture.pairs.set(pair, (colour.capture.pairs.get(pair) ?? 0) + 1);
      }
      const h = host ? host.replace(/\d.*$/, "") : "?";
      const t = colour.capture.byHost.get(h) ?? { agree: 0, disagree: 0 };
      if (host) {
        if (starKeys(host).has(v.toUpperCase())) t.agree += 1;
        else t.disagree += 1;
        colour.capture.byHost.set(h, t);
      }
    }
  }
}

/* ------------------------------------------------------------------ the truth table */

mkdirSync(outDir, { recursive: true });
const excluded = new Set<string>(); // `${bodyKey}|${genus}`
for (const list of Object.values(c4)) {
  for (const d of list.disagree) {
    const [name, rest] = d.split(" — ");
    excluded.add(`${bodyKeyOf(name!)}|${rest!.split(":")[0]}`);
  }
}
for (const src of SOURCES) {
  for (const d of c3[src]) {
    const [name, rest] = d.split(" — ");
    excluded.add(`${bodyKeyOf(name!)}|${rest!.split(":")[0]}`);
  }
}

const colourByBodySpecies = new Map<string, string>();
for (const c of claims) if (c.colour && c.entry) colourByBodySpecies.set(`${c.bodyKey}|${c.entry.id}`, c.colour);

let rowsOut = 0;
const perSpecies = new Map<string, Record<Source, number>>();
const lines: string[] = [];
for (const [bk, perSource] of byBody) {
  const genera = new Set<string>();
  for (const g of perSource.values()) for (const k of g.keys()) genera.add(k);
  for (const genus of genera) {
    if (excluded.has(`${bk}|${genus}`)) continue;
    const sources = SOURCES.filter((s) => perSource.get(s)?.get(genus));
    const species = [...perSource.get(sources[0]!)!.get(genus)!][0]!;
    if (species.startsWith("?")) continue; // unresolved labels are reported, not tabled
    const tally = perSpecies.get(species) ?? { journal: 0, corpus: 0, capture: 0 };
    for (const s of sources) tally[s] += 1;
    perSpecies.set(species, tally);
    lines.push(
      JSON.stringify({
        body: bodyName.get(bk),
        genus,
        species,
        colour: colourByBodySpecies.get(`${bk}|${species}`) ?? null,
        sources,
        physics: {
          journal: journalPhysics.get(bk) ?? null,
          corpus: corpusPhysics.get(bk) ?? null,
          capture: capturePhysics.get(bk) ?? null,
        },
      }),
    );
    rowsOut += 1;
  }
}
writeFileSync(path.join(outDir, "truth-table.jsonl"), lines.join("\n") + "\n");

/* ------------------------------------------------------------------ the report */

const pc = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)} %` : "—");
const list = (xs: string[], max = 40) =>
  xs.length ? xs.slice(0, max).map((x) => `- ${x}`).join("\n") + (xs.length > max ? `\n- … ${xs.length - max} more` : "") : "_none_";

const r: string[] = [];
r.push(`# Species precision — phase 0 label check`, ``, `Generated ${new Date().toISOString()} by \`scripts/precision-phase0.ts\`. Local only.`, ``);
r.push(`## Inputs`, ``);
r.push(`- journals: ${journalFiles} files; ${journalCounts.scanOrganic} Log/Sample scans (${journalCounts.analyseSkipped} Analyse skipped), ${journalCounts.codex} organic codex entries; ${journalNoScan} claims without a body Scan, dropped`);
r.push(`- corpus: ${corpusCounts.folders} species folders, ${corpusCounts.docs} pack records, ${corpusCounts.bodies} bodies with physics, ${corpusCounts.noCache} with no system cache`);
r.push(`- capture: ${capturePath ? path.basename(capturePath) : "none"}; ${captureCounts.bodies} bodies, ${captureCounts.withBio} with organic tokens (${captureCounts.analyseSkipped} Analyse skipped)`);
r.push(`- claims: ${SOURCES.map((s) => `${s} ${claims.filter((c) => c.source === s).length}`).join(", ")}`, ``);

r.push(`## C1 — journal: one name per token`, ``, `${journalNames.size} tokens; ${c1.length} with more than one name.`, ``);
r.push(list(c1.map(([k, n]) => `${k}: ${[...n].map(([a, b]) => `${a} ×${b}`).join(", ")}`)), ``);

r.push(`## C2 — collector table against the journal`, ``);
r.push(
  collectorCheck.available
    ? `${collectorCheck.agree} agree, **${collectorCheck.disagree.length} disagree**, ${collectorCheck.collectorOnly} tokens only the collector names (used for the capture, unverified).`
    : `Collector not found at the sibling path — capture tokens the journal never saw stay unnamed.`,
  ``,
  list(collectorCheck.disagree),
  ``,
);
if (captureCounts.unnamedToken.size)
  r.push(`Capture tokens nobody names: ${[...captureCounts.unnamedToken].map(([k, n]) => `${k} ×${n}`).join(", ")}`, ``);

r.push(`## C3 — one species per genus per body`, ``);
for (const s of SOURCES) r.push(`### ${s}: ${c3[s].length} bodies with two species of one genus`, ``, list(c3[s]), ``);

r.push(`## C4 — sources against each other, per body and genus`, ``);
for (const [name, res] of Object.entries(c4)) {
  r.push(`### ${name}`, ``, `${res.bodies} shared bodies, ${res.slots} shared genus slots: **${res.agree} agree (${pc(res.agree, res.slots)})**, ${res.disagree.length} disagree.`, ``, list(res.disagree), ``);
}

r.push(`## C5 — labels the tree cannot place`, ``);
r.push(list([...unresolved].sort((a, b) => b[1].n - a[1].n).map(([l, u]) => `${l} ×${u.n} (${[...u.sources].join(", ")})`)), ``);

r.push(`## C6 — colour`, ``);
const jc = colour.journal;
const jTotal = jc.right + jc.amongCandidates + jc.wrong.length + jc.undecided;
r.push(`### journal: the app's rule against the game's colour`, ``);
r.push(`${jTotal} judged: **${jc.right} exact**, ${jc.amongCandidates} among the candidates, **${jc.wrong.length} wrong**, ${jc.undecided} undecided; ${jc.noHost} skipped (host star unresolved), no rule for: ${[...jc.noRule].join(", ") || "none"}.`, ``, list(jc.wrong), ``);
const cc = colour.capture;
r.push(`### capture: variant tokens against the tables`, ``);
r.push(`${cc.covered} covered by a table entry; not in any table: ${cc.notInTable.size} variant kinds.`, ``, list([...cc.notInTable].map(([k, n]) => `${k} ×${n}`)), ``);
r.push(`Star-set variants against the capture's host star: ${cc.hostAgrees} agree, **${cc.hostDisagrees.length} disagree**, ${cc.hostUnknown} host unknown.`, ``);
r.push(`Per host class — does the colour follow the star the body orbits?`, ``, `| host | follows | does not |`, `|---|---:|---:|`);
for (const [h, t] of [...cc.byHost].sort((a, b) => b[1].disagree - a[1].disagree)) r.push(`| ${h} | ${t.agree} | ${t.disagree} |`);
r.push(``, `Where it does not, the class the token names instead:`, ``, list([...cc.pairs].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ×${n}`), 30), ``);
r.push(`Rows:`, ``, list(cc.hostDisagrees), ``);

r.push(`## Truth table`, ``, `${rowsOut} body×genus rows written to \`truth-table.jsonl\`; ${excluded.size} excluded for a C3 or C4 conflict.`, ``);
r.push(`| species | journal | corpus | capture |`, `|---|---:|---:|---:|`);
for (const [sp, t] of [...perSpecies].sort((a, b) => a[0].localeCompare(b[0]))) r.push(`| ${sp} | ${t.journal} | ${t.corpus} | ${t.capture} |`);
const missing = db.species.filter((e) => !perSpecies.has(e.id)).map((e) => e.id);
r.push(``, `Tree species with no truth row at all: ${missing.length ? missing.join(", ") : "none"}.`, ``);

writeFileSync(path.join(outDir, "phase0-report.md"), r.join("\n"));
console.log(r.slice(0, 12).join("\n"));
console.log(`\nC1 ${c1.length} · C2 disagree ${collectorCheck.disagree.length} · C3 ${SOURCES.map((s) => `${s} ${c3[s].length}`).join("/")} · ` +
  `C4 ${Object.entries(c4).map(([k, v]) => `${k} ${v.agree}/${v.slots}`).join(", ")} · C5 ${unresolved.size} labels · ` +
  `C6 journal ${jc.right}+${jc.amongCandidates}/${jTotal} wrong ${jc.wrong.length}, capture host disagree ${cc.hostDisagrees.length}`);
console.log(`truth rows ${rowsOut}; report ${path.relative(root, path.join(outDir, "phase0-report.md"))}`);
