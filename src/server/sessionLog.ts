/**
 * The play session as a log (owner, NEXT-TASKS 11): what happened since the app started, from live
 * journal lines only — systems jumped to, bodies landed on, species analysed with what they will
 * pay, first footfalls, sales. Nothing is replayed from history: the replay is the past, this is
 * tonight. The web UI shows it in a modal and copies it as Markdown for notes or a stream overlay.
 */
import type { GameStateStore } from "./gameState.js";
import type { JournalLine, SessionLogDTO } from "../shared/types.js";
import { lookupPrice, type PriceIndex } from "./priceList.js";
import { displayLabelFromOrganicLine } from "./organicTracking.js";

const MAX_ROWS = 400;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export class SessionLog {
  readonly startedIso = new Date().toISOString();
  private systems: SessionLogDTO["systems"] = [];
  private landings: SessionLogDTO["landings"] = [];
  private samples: SessionLogDTO["samples"] = [];
  private sales: SessionLogDTO["sales"] = [];
  /** Analyse lines already counted, so a re-emitted third scan does not add a second row. */
  private seenSamples = new Set<string>();

  record(line: JournalLine, store: GameStateStore, prices: PriceIndex): boolean {
    const event = str(line.event);
    const at = str(line.timestamp) || new Date().toISOString();
    if (event === "FSDJump" || event === "CarrierJump") {
      const name = str(line.StarSystem);
      if (!name) return false;
      const last = this.systems[this.systems.length - 1];
      if (last && last.name === name) return false;
      this.push(this.systems, { name, at, jumpLy: num(line.JumpDist) });
      return true;
    }
    if (event === "Touchdown") {
      if (line.PlayerControlled === false) return false;
      const body = str(line.Body);
      if (!body) return false;
      const system = str(line.StarSystem) || store.currentSystem || "";
      const addr = num(line.SystemAddress) ?? store.currentSystemAddress;
      const bodyId = num(line.BodyID);
      const key = addr != null && bodyId != null ? `${addr}:${bodyId}` : null;
      const last = this.landings[this.landings.length - 1];
      if (last && last.body === body && Date.parse(at) - Date.parse(last.at) < 5 * 60_000) return false;
      this.push(this.landings, {
        body,
        system,
        at,
        firstFootfall: key != null && store.firstFootfallBodies.has(key),
        key,
      });
      return true;
    }
    if (event === "Disembark" || event === "Disembarked") {
      // First footfall is settled by the store on this line; refresh the landing it belongs to.
      const addr = num(line.SystemAddress) ?? store.currentSystemAddress;
      const bodyId = num(line.BodyID);
      if (addr == null || bodyId == null) return false;
      const key = `${addr}:${bodyId}`;
      let changed = false;
      for (const l of this.landings) {
        if (l.key === key && !l.firstFootfall && store.firstFootfallBodies.has(key)) {
          l.firstFootfall = true;
          changed = true;
        }
      }
      return changed;
    }
    if (event === "ScanOrganic") {
      if (str(line.ScanType) !== "Analyse") return false;
      const species = displayLabelFromOrganicLine(line) || str(line.Species_Localised) || str(line.Species);
      if (!species) return false;
      const addr = num(line.SystemAddress) ?? store.currentSystemAddress;
      const bodyId = num(line.Body);
      const key = addr != null && bodyId != null ? `${addr}:${bodyId}` : "";
      const dedupe = `${key}|${species.toLowerCase()}`;
      if (this.seenSamples.has(dedupe)) return false;
      this.seenSamples.add(dedupe);
      const list = lookupPrice(prices, species, species);
      const first = key !== "" && store.firstFootfallBodies.has(key);
      const bodyName = (key && store.bodies.get(key)?.bodyName) || (bodyId != null ? `Body ${bodyId}` : "");
      this.push(this.samples, {
        species,
        body: bodyName,
        system: store.currentSystem ?? "",
        at,
        listCredits: list,
        mult: first ? 5 : 1,
        credits: list != null ? list * (first ? 5 : 1) : null,
      });
      return true;
    }
    if (event === "SellOrganicData") {
      const bios = Array.isArray(line.BioData) ? (line.BioData as Record<string, unknown>[]) : [];
      let total = 0;
      let n = 0;
      for (const b of bios) {
        const v = num(b?.Value) ?? 0;
        const bonus = num(b?.Bonus) ?? 0;
        total += v + bonus;
        n += 1;
      }
      if (n === 0) return false;
      this.push(this.sales, { at, items: n, credits: total });
      return true;
    }
    return false;
  }

  private push<T>(list: T[], row: T): void {
    list.push(row);
    if (list.length > MAX_ROWS) list.splice(0, list.length - MAX_ROWS);
  }

  toDto(): SessionLogDTO {
    return {
      startedIso: this.startedIso,
      systems: this.systems,
      landings: this.landings,
      samples: this.samples,
      sales: this.sales,
      firstFootfalls: this.landings.filter((l) => l.firstFootfall).length,
      creditsAnalysed: this.samples.reduce((s, x) => s + (x.credits ?? 0), 0),
      creditsSold: this.sales.reduce((s, x) => s + x.credits, 0),
    };
  }
}
