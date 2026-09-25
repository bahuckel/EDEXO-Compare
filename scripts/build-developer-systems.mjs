#!/usr/bin/env node
/**
 * Build `data/galaxy/developer-populated-systems.json` — the systems Frontier populated.
 *
 *   node scripts/build-developer-systems.mjs
 *
 * Asks Spansh's system search for every system with a population and `is_colonised: false`. The
 * search stops at 10,000 results, so the population range is split into bands until each band fits,
 * then every band is paged through, 100 rows and one request a second — about 210 requests. The
 * downloadable dumps do not carry the colonised flag; only the search does.
 *
 * Re-run it now and then: the developer set practically never changes, but it is cheap.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "data", "galaxy", "developer-populated-systems.json");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const UA = `ED-Exo-Compare/${pkg.version} (+https://github.com/bahuckel/EDEXO-Compare)`;
const URL = "https://spansh.co.uk/api/systems/search";
const CAP = 10_000;
const PAGE = 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function search(filters, page = 0, size = PAGE) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": UA },
        body: JSON.stringify({ filters, sort: [{ id64: { direction: "asc" } }], size, page }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      console.warn(`  retry ${attempt + 1}: ${e.message}`);
      await sleep(5000 * (attempt + 1));
    }
  }
  throw new Error("Spansh search failed");
}

const bandFilter = (lo, hi) => ({
  population: { comparison: "<=>", value: [lo, hi] },
  is_colonised: { value: false },
});

// Split the population range until every band is under the cap.
const todo = [[1, 1e14]];
const bands = [];
while (todo.length) {
  const [lo, hi] = todo.pop();
  const { count } = await search(bandFilter(lo, hi), 0, 1);
  await sleep(1000);
  if (count >= CAP && hi - lo > 1) {
    const mid = Math.max(lo + 1, Math.min(hi - 1, Math.floor(Math.sqrt(lo * hi))));
    todo.push([lo, mid], [mid + 1, hi]);
  } else bands.push([lo, hi, count]);
}
bands.sort((a, b) => a[0] - b[0]);
console.log(`bands: ${JSON.stringify(bands)}`);

const systems = new Set();
for (const [lo, hi, count] of bands) {
  for (let page = 0; page * PAGE < count; page++) {
    const d = await search(bandFilter(lo, hi), page);
    for (const r of d.results ?? []) systems.add(r.id64);
    await sleep(1000);
  }
  console.log(`  ${lo}–${hi}: ${count} expected, ${systems.size} so far`);
}

const expected = bands.reduce((s, b) => s + b[2], 0);
if (systems.size < expected * 0.99) throw new Error(`got ${systems.size} of ${expected}; not writing`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  `${JSON.stringify({
    source: "Spansh system search: population > 0 and is_colonised false",
    builtAt: new Date().toISOString(),
    count: systems.size,
    systems: [...systems].sort((a, b) => a - b),
  })}\n`,
);
console.log(`wrote ${systems.size} systems to ${out}`);
