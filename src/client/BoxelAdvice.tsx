/**
 * The Boxels screen's mass code tables (behind its [?]) and "Looking for" (owner, 2026-10-05: "get
 * people to do boxel searching depending on what they are looking for … he selects sector, looking
 * for > Black holes > app points him to f, g, h mass boxels, he selects one, enters the number of
 * systems in the boxel and starts exploring"). Numbers from shared/boxelRates.ts (the Spansh dump) and
 * shared/boxelBioRates.ts (EDAstro's codex file); the logic is shared/boxelAdvice.ts.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { BoxelName } from "@shared/boxel";
import {
  ALL_BOXEL_TARGETS,
  formatBoxelRate,
  goldenBoxels,
  goldenInSector,
  goldenTargetsAt,
  MASS_CODE_LETTERS,
  massCodeRate,
  nearestBoxels,
  rankMassCodes,
  type BoxelLetters,
  type BoxelTarget,
  type MassCode,
  type SuggestedBoxel,
} from "@shared/boxelAdvice";
import { BOXEL_RATES } from "@shared/boxelRates";
import { BOXEL_BIO_RATES } from "@shared/boxelBioRates";
import { Select } from "./ui/Select";
import { IconSave } from "./ui/icons";
import { CopySystemButton } from "./CopySystemButton";
import { oneOf, usePersistedState } from "./usePersistedState";

/** A share for a table cell: `42 %`, `7.3 %`, and under 1 % as `1/158` (rare things read better that way). */
const pct = (v: number) =>
  v >= 0.0995
    ? `${(v * 100).toFixed(0)} %`
    : v >= 0.01
      ? `${(v * 100).toFixed(1)} %`
      : v > 0
        ? `1/${Math.round(1 / v).toLocaleString("en")}`
        : "—";

/** The best value of each column bold and green (owner: "if a letter is the best for something"). */
function RateTable({
  caption,
  columns,
  rows,
  value,
  fmt = pct,
}: {
  caption: string;
  columns: { key: string; label: string; title?: string; fmt?: (v: number) => string }[];
  rows: readonly string[];
  value: (row: string, col: string) => number | null;
  fmt?: (v: number) => string;
}) {
  const best = new Map(columns.map((c) => [c.key, Math.max(...rows.map((r) => value(r, c.key) ?? -1))]));
  return (
    <div className="boxel-rates__wrap">
      <table className="boxel-rates">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Mass</th>
            {columns.map((c) => (
              <th key={c.key} scope="col" title={c.title}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r}>
              <th scope="row">{r}</th>
              {columns.map((c) => {
                const v = value(r, c.key);
                const top = v != null && v > 0 && v === best.get(c.key);
                return (
                  <td key={c.key} className={top ? "boxel-best" : undefined}>
                    {v == null ? "·" : (c.fmt ?? fmt)(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const MAIN_STARS: { key: string; label: string; title?: string }[] = [
  { key: "M", label: "M" },
  { key: "K", label: "K" },
  { key: "G", label: "G" },
  { key: "F", label: "F" },
  { key: "A", label: "A" },
  { key: "B", label: "B" },
  { key: "O", label: "O" },
  { key: "LTY", label: "L/T/Y", title: "Brown dwarfs" },
  { key: "TTS", label: "TTS", title: "T Tauri" },
  { key: "AeBe", label: "Ae/Be", title: "Herbig Ae/Be" },
  { key: "W", label: "WR", title: "Wolf-Rayet" },
  {
    key: "C",
    label: "Carbon",
    title: "Carbon stars: C, CN, CJ, CH, CHd and CS, with the MS- and S-type stars",
  },
  { key: "D", label: "WD", title: "White dwarf" },
  { key: "N", label: "NS", title: "Neutron star" },
  { key: "H", label: "BH", title: "Black hole" },
];

const FOUND: { key: string; label: string; title?: string; fmt?: (v: number) => string }[] = [
  { key: "elw", label: "ELW", title: "Earth-like world" },
  { key: "ww", label: "WW", title: "Water world" },
  { key: "aw", label: "AW", title: "Ammonia world" },
  { key: "tf", label: "Terraf.", title: "Terraformable body" },
  { key: "bio", label: "Bio", title: "Biological signals" },
  { key: "geo", label: "Geo", title: "Geological signals" },
  {
    key: "heRich",
    label: "He-rich GG",
    title: "Helium-rich gas giants per 1,000 systems",
    fmt: (v) => v.toFixed(v >= 10 ? 0 : 1),
  },
];

const MASS_ROWS = MASS_CODE_LETTERS as readonly string[];

/** Behind the screen's [?]: what a mass code says, as measured. */
export function BoxelMassCodeHelp() {
  const genera = useMemo(() => {
    const g = new Set<string>();
    for (const r of Object.values(BOXEL_BIO_RATES))
      for (const k of Object.keys(r.all.hits)) if (k.startsWith("g:")) g.add(k);
    return [...g].sort();
  }, []);
  const main = (m: string, k: string) => {
    const r = BOXEL_RATES[m]!.all;
    if (!r.n) return null;
    const hits =
      k === "LTY"
        ? ["L", "T", "Y"].reduce((s, x) => s + (r.hits[`main:${x}`] ?? 0), 0)
        : (r.hits[`main:${k}`] ?? 0);
    return hits / r.n;
  };
  const found = (m: string, k: string) => massCodeRate(m as MassCode, k)?.rate ?? null;
  const bio = (m: string, k: string) => {
    const r = BOXEL_BIO_RATES[m]?.all;
    return r && r.n >= 500 ? (r.hits[k] ?? 0) / r.n : null;
  };
  return (
    <section className="boxel-help fold-help" aria-label="What a mass code says">
      {/* Owner, 2026-10-06: straight to the point, the explanations on hover. */}
      <p
        className="boxel-help__lead"
        title="In a boxel name such as AK-Y c14, the capital letters and the number after the small letter (AK-Y … 14) are where the boxel sits in its sector. The small letter, a to h, is the mass code: how big the boxel is (10 ly to 1,280 ly), and so how heavy its stars are."
      >
        <strong>Mass code</strong> = the small letter in <strong>AK-Y c14</strong>: <strong>a</strong> 10 ly …{" "}
        <strong>h</strong> 1,280 ly. Best per column in <span className="boxel-best">green</span>.
      </p>
      <RateTable caption="Main star" columns={MAIN_STARS} rows={MASS_ROWS} value={main} />
      <RateTable caption="Found in a system" columns={FOUND} rows={MASS_ROWS} value={found} />
      <RateTable
        caption="Exobiology (genus)"
        columns={genera.map((g) => ({ key: g, label: g.slice(2) }))}
        rows={MASS_ROWS}
        value={bio}
      />
      <p
        className="dim tiny"
        title="Main star and Found: share of systems with bodies known on the Spansh galaxy dump (199.7 million systems, 2026-10-05); Helium-rich gas giants per 1,000 systems. Exobiology: share of systems with biology logged in EDAstro's codex file (1.8 million). Commanders fly interesting systems first, so rare things read a little high; the ranking between mass codes is what this is for. · = too few systems to say."
      >
        Spansh dump + EDAstro codex · hover for how
      </p>
    </section>
  );
}

const GROUPS = ["Signals", "Worlds", "Stars", "Genus", "Species"] as const;
type Group = (typeof GROUPS)[number];
type Scope = "boxel" | "sector";

/** System 0 of a boxel: `… AB-C d1-0`, or `… AB-C h0` when the boxel has no number. */
export function firstSystemOf(sector: string, boxel: string): string {
  return /\d$/.test(boxel) ? `${sector} ${boxel}-0` : `${sector} ${boxel}0`;
}

/** "Looking for": which mass codes, and which boxels of this sector, to fly for a target. */
export function BoxelLookingFor({
  here,
  onSave,
}: {
  here: BoxelName | null;
  /** Saves a boxel by one of its systems (the screen's Plan, with its Last system #). */
  onSave: (system: string) => void;
}) {
  const [group, setGroup] = usePersistedState<Group>("boxel.lookGroup", "Signals", oneOf(...GROUPS));
  const [targetKey, setTargetKey] = usePersistedState<string>(
    "boxel.lookFor",
    "",
    (v): v is string => typeof v === "string",
  );
  const [scope, setScope] = usePersistedState<Scope>("boxel.lookScope", "boxel", oneOf("boxel", "sector"));
  const [letters, setLetters] = usePersistedState<BoxelLetters>(
    "boxel.lookLetters",
    "any",
    oneOf("any", "AA-A"),
  );
  const [pos, setPos] = useState<{ x: number; y: number; z: number } | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/galaxy/route")
      .then((r) =>
        r.ok ? (r.json() as Promise<{ position: { x: number; y: number; z: number } | null }>) : null,
      )
      .then((d) => live && setPos(d?.position ?? null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [here?.prefix]);

  const options = ALL_BOXEL_TARGETS.filter((t) => t.group === group);
  const target: BoxelTarget | undefined = options.find((t) => t.key === targetKey);
  const ranks = useMemo(() => (target ? rankMassCodes(target.key, letters) : []), [target, letters]);
  const fmt = (v: number) => formatBoxelRate(v, target?.perThousand);

  let verdict: ReactNode = null;
  if (target && scope === "boxel") {
    if (!here) {
      verdict = <p className="dim">You are in a system with a catalogue name: it belongs to no boxel.</p>;
    } else {
      const aaA = /^AA-A /.test(here.boxel);
      const mine = massCodeRate(
        here.massCode as MassCode,
        target.key,
        letters === "AA-A" && aaA ? "AA-A" : "any",
      );
      const best = ranks[0];
      verdict = mine ? (
        <p>
          Your boxel <strong>{here.boxel}</strong> is a <strong>{here.massCode}</strong> boxel:{" "}
          {target.label.toLowerCase()} in <strong>{fmt(mine.rate)}</strong>
          {target.perThousand ? "" : " of its systems"}
          {best && best.code === here.massCode ? (
            <span className="boxel-best"> — the best mass code for it.</span>
          ) : best ? (
            <>
              {" "}
              — <strong className="boxel-best">{best.code}</strong> boxels do better ({fmt(best.rate)}).
            </>
          ) : null}
          {letters === "AA-A" && !aaA ? (
            <span className="dim"> (Your boxel is not AA-A: its rate is for every boxel.)</span>
          ) : null}
        </p>
      ) : (
        <p className="dim">Too few {here.massCode} boxels measured to say.</p>
      );
    }
  }

  let suggestions: ReactNode = null;
  if (target && scope === "sector") {
    if (!here || !pos) {
      suggestions = (
        <p className="dim">
          {here
            ? "Waiting for your position…"
            : "You are in a system with a catalogue name: no sector to search."}
        </p>
      );
    } else {
      const sector = here.sector;
      const golden = goldenBoxels(target.key);
      const bioGolden = golden.some((g) => g.kind === "bio");
      // The six strongest, nearest first (they are close in strength; the distance decides the flight).
      const goldenHere = golden
        .slice(0, 6)
        .map((g) => ({ g, s: goldenInSector(g, pos) }))
        .sort((a, b) => a.s.ly - b.s.ly);
      const codes = ranks.slice(0, 2);
      /*
        A boxel as a system reads (owner, 2026-10-06): the name first with a copy button (its system 0,
        to paste in the galaxy map without saving it), then how far, then the short figure; the long
        one on hover. Save is a floppy disk.
      */
      const row = (b: SuggestedBoxel, short: string, long: string) => (
        <li key={b.boxel} className="boxel-advice__item" title={long}>
          <strong>
            {sector} {b.boxel}
          </strong>
          <CopySystemButton system={firstSystemOf(sector, b.boxel)} />
          <span className="dim tiny">
            {Math.round(b.ly).toLocaleString("en")} ly · {short}
          </span>
          <button
            type="button"
            className="fdb-chip boxel-advice__save"
            title={`Save ${sector} ${b.boxel} to your boxels (to the Last system # you typed, if any)`}
            aria-label={`Save ${sector} ${b.boxel}`}
            onClick={() => onSave(firstSystemOf(sector, b.boxel))}
          >
            <IconSave />
          </button>
        </li>
      );
      suggestions = (
        <div className="boxel-advice__lists">
          {goldenHere.length ? (
            <div>
              <h4>Golden boxels in {sector}</h4>
              <ul>
                {goldenHere.map(({ g, s }) =>
                  row(
                    s,
                    `${pct(g.rate)} · ×${(g.rate / g.rest).toFixed(1)}${g.kind === "bio" && g.confirmed ? " · 2 sources" : ""}`,
                    g.kind === "bio"
                      ? `${pct(g.rate)} of its systems with biology, against ${pct(g.rest)} in other ${g.code} boxels${g.confirmed ? " — two sources agree" : " — one source"}`
                      : `${pct(g.rate)} of its systems, against ${pct(g.rest)} in other ${g.code} boxels`,
                  ),
                )}
              </ul>
              <p
                className="boxel-advice__disclaimer tiny"
                title={
                  bioGolden
                    ? "The same place in every sector, measured in EDAstro's codex over the whole galaxy and true in both halves of it; two sources: the Spansh bio export finds it too. For Bark Mounds and Electricae these are where nebulae tend to sit (a nebula within 100 ly 14 times as often)."
                    : "The same place in every sector, measured on the whole Spansh galaxy dump, true in both halves of the galaxy and still there in boxels nearly fully explored. Most sit in the sector's lowest layers, near the galactic plane."
                }
              >
                Not guaranteed — a statistical lead: any one boxel can have none. Hover for how.
              </p>
            </div>
          ) : null}
          {codes.map((r) => (
            <div key={r.code}>
              <h4>
                Nearest <span className="boxel-best">{r.code}</span> boxels
                {letters === "AA-A" ? " (AA-A)" : ""} · {fmt(r.rate)}
              </h4>
              <ul>
                {nearestBoxels(r.code, pos, 4, letters).map((b) =>
                  row(b, `${r.code} boxel`, `${r.code} boxel: ${fmt(r.rate)} on average`),
                )}
              </ul>
            </div>
          ))}
        </div>
      );
    }
  }

  return (
    <section className="boxel-advice" aria-label="Looking for">
      <div className="boxel-advice__bar">
        <span className="dim tiny">Looking for</span>
        <Select<Group>
          value={group}
          ariaLabel="Kind of target"
          options={GROUPS.map((g) => ({ value: g, label: g }))}
          onChange={(g) => {
            setGroup(g);
            setTargetKey("");
          }}
        />
        <Select<string>
          value={target ? target.key : ""}
          ariaLabel="Looking for"
          menuMinWidth={260}
          options={[
            { value: "", label: "Choose…" },
            ...options.map((t) => ({ value: t.key, label: t.label })),
          ]}
          onChange={setTargetKey}
        />
        <span className="dim tiny">in</span>
        <span className="boxel-advice__seg" role="group" aria-label="Where">
          {(
            [
              ["boxel", "This boxel"],
              ["sector", "This sector"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`fdb-chip${scope === k ? " fdb-chip--on" : ""}`}
              onClick={() => setScope(k)}
            >
              {label}
            </button>
          ))}
        </span>
        <span className="boxel-advice__seg" role="group" aria-label="Boxel letters">
          {(
            [
              ["any", "Any letters"],
              ["AA-A", "AA-A only"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`fdb-chip${letters === k ? " fdb-chip--on" : ""}`}
              title={
                k === "AA-A"
                  ? "Only boxels lettered AA-A: in d to h, the sector's corner boxel"
                  : "Every boxel"
              }
              onClick={() => setLetters(k)}
            >
              {label}
            </button>
          ))}
        </span>
        {target && ranks.length ? (
          <span className="boxel-advice__ranks">
            {ranks.slice(0, 4).map((r, i) => (
              <span
                key={r.code}
                className={i === 0 ? "boxel-best" : "dim"}
                title={`${r.hits.toLocaleString("en")} of ${r.systems.toLocaleString("en")} systems`}
              >
                {r.code} {fmt(r.rate)}
              </span>
            ))}
          </span>
        ) : target ? (
          <span className="dim tiny">Not enough measured to rank.</span>
        ) : null}
      </div>
      {verdict || suggestions ? <div className="boxel-advice__out">{verdict ?? suggestions}</div> : null}
    </section>
  );
}

/**
 * A saved boxel that sits at a golden place (the same letters in any sector): "golden", with what for
 * on hover. Only places a second source confirms count here; the one-source ones stay in Looking for.
 */
export function GoldenTag({ boxel }: { boxel: string }) {
  const hits = goldenTargetsAt(boxel).filter((g) => g.confirmed);
  if (!hits.length) return null;
  // One line per thing: a genus goes when one of its species is listed ("Electricae" beside
  // "Electricae Radialem"), and "Bark Mound" beside "Bark Mounds".
  const norm = (t: string) => t.replace(/s$/, "").toLowerCase();
  const names = hits.map((g) => norm(g.target));
  const seen = new Set<string>();
  const lines = hits.filter((g) => {
    const k = norm(g.target);
    if (seen.has(k) || names.some((n) => n !== k && (n.startsWith(`${k} `) || n.endsWith(` ${k}`))))
      return false;
    seen.add(k);
    return true;
  });
  return (
    <span
      className="boxel-golden"
      title={`A golden boxel: in boxels at this place of their sector, ${lines
        .map(
          (g) =>
            `${g.target} ${pct(g.rate)} of systems${g.kind === "bio" ? " with biology" : ""} (other boxels ${pct(g.rest)})`,
        )
        .join("; ")}. A strong lead, not a promise.`}
    >
      golden:{" "}
      {lines
        .slice(0, 2)
        .map((g) => g.target)
        .join(", ")}
      {lines.length > 2 ? ` +${lines.length - 2}` : ""}
    </span>
  );
}
