/**
 * The EDDN collector's codex ledger (owner, 2026-10-04, plan O-G): when one runs on this machine, plants
 * relayed since EDSM's dump count against [CODEX FIRST]; when none does, nothing changes.
 */
import { afterEach, describe, expect, it } from "vitest";
import { codexFirstCheck, resetCodexFirst } from "../src/server/codexFirst.js";
import { eddnLedgerStatus, ledgerTokenToCodexId, parseLedger, refreshEddnLedger } from "../src/server/eddnLedger.js";
import { getProjectRoot } from "../src/server/paths.js";

const root = getProjectRoot();
const manifest = '{"kind":"manifest","source":"eddn-bio-collector","content":"codex-ledger","formatVersion":1}';
const row = (token: string, region: string, category = "$Codex_Category_Biology;") =>
  JSON.stringify({ kind: "codex", token, region, category, systemId64: "1", bodyId: 2 });
const fakeFetch = (body: string, ok = true) =>
  (async () => new Response(body, { status: ok ? 200 : 500 })) as unknown as typeof fetch;

afterEach(() => resetCodexFirst());

describe("the EDDN collector's ledger", () => {
  it("reads its tokens as EDSM's codex ids, plants only", () => {
    expect(ledgerTokenToCodexId("$Codex_Ent_Aleoids_01_A_Name;")).toBe("codex_ent_aleoids_01_a");
    const ids = parseLedger(
      [manifest, row("$Codex_Ent_Aleoids_01_A_Name;", "Inner Orion Spur"), row("$Codex_Ent_Black_Holes_Name;", "Outer Arm", "$Codex_Category_StellarBodies;")].join("\n"),
    );
    expect([...ids]).toHaveLength(1);
    expect([...ids][0]).toMatch(/\|codex_ent_aleoids_01_a$/);
  });

  it("a plant on the ledger is no longer a first; without the collector it is again", async () => {
    // Cactoida Cortexum - Green is not in EDSM's dump for Errant Marches (data/codex, generated 2026-10-01).
    const region = "Errant Marches";
    expect(codexFirstCheck(root, region, "Cactoida Cortexum", "Green", null)).not.toBeNull();
    await refreshEddnLedger(root, fakeFetch([manifest, row("$Codex_Ent_Cactoid_01_A_Name;", region)].join("\n")));
    expect(eddnLedgerStatus()).toMatchObject({ found: true, plantRows: 1 });
    expect(codexFirstCheck(root, region, "Cactoida Cortexum", "Green", null)).toBeNull();
    // Another colour of it is still a first: the ledger names the colour.
    expect(codexFirstCheck(root, region, "Cactoida Cortexum", "Mauve", null)).not.toBeNull();
    await refreshEddnLedger(root, fakeFetch("", false));
    expect(eddnLedgerStatus().found).toBe(false);
    expect(codexFirstCheck(root, region, "Cactoida Cortexum", "Green", null)).not.toBeNull();
  });

  it("stays quiet when nothing answers", async () => {
    const s = await refreshEddnLedger(root, (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch);
    expect(s.found).toBe(false);
  });
});
