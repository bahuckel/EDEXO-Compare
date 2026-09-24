// @vitest-environment jsdom
/**
 * The glance bar's genus chips: at most three, the newest scan on the right, arrows to step back
 * through older ones, and a count of the genera nothing has touched yet (owner, 2026-09-25).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GlanceGenera } from "../src/client/BodyPane";
import type { GenusProgressRow } from "../src/shared/genusProgress";

let root: Root | null = null;
let host: HTMLDivElement;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  root?.unmount();
  root = createRoot(host);
});

const row = (
  genus: string,
  minute: number | null,
  status: GenusProgressRow["status"] = "seen",
): GenusProgressRow => ({
  genus,
  species: null,
  variant: null,
  status,
  samples: status === "done" ? 3 : null,
  hint: null,
  at: minute == null ? null : `2026-09-24T12:${String(minute).padStart(2, "0")}:00Z`,
});

function mount(rows: GenusProgressRow[]) {
  act(() => root!.render(<GlanceGenera rows={rows} />));
}
const chips = () => [...host.querySelectorAll(".glance-genus")].map((c) => c.textContent);
const [older, newer] = ["Earlier scans", "Later scans"];
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

describe("glance genus chips", () => {
  it("shows the last three scanned, newest on the right, and counts the rest to scan", () => {
    mount([
      row("Aleoida", 1),
      row("Bacterium", 2, "done"),
      row("Cactoida", 3),
      row("Fungoida", 4),
      row("Osseus", 5),
      row("Tussock", null, "dss"),
    ]);
    expect(chips()).toEqual(["Cactoida[SEEN]", "Fungoida[SEEN]", "Osseus[SEEN]"]);
    expect(host.querySelector(".glance-genus-left")?.textContent).toBe("+1 to scan");
  });

  it("steps back to older scans and forward again", () => {
    mount([row("Aleoida", 1), row("Bacterium", 2), row("Cactoida", 3), row("Fungoida", 4), row("Osseus", 5)]);
    expect(button(newer).disabled).toBe(true);
    act(() => button(older).click());
    expect(chips()).toEqual(["Bacterium[SEEN]", "Cactoida[SEEN]", "Fungoida[SEEN]"]);
    act(() => button(older).click());
    expect(chips()).toEqual(["Aleoida[SEEN]", "Bacterium[SEEN]", "Cactoida[SEEN]"]);
    expect(button(older).disabled).toBe(true);
    act(() => button(newer).click());
    expect(chips()).toEqual(["Bacterium[SEEN]", "Cactoida[SEEN]", "Fungoida[SEEN]"]);
  });

  it("has no arrows with three or fewer, and says what is left before anything is scanned", () => {
    mount([row("Aleoida", 1), row("Bacterium", 2)]);
    expect(host.querySelectorAll(".glance-genus-step")).toHaveLength(0);
    mount([row("Tussock", null, "dss"), row("Stratum", null, "dss")]);
    expect(chips()).toEqual([]);
    expect(host.querySelector(".glance-genus-left")?.textContent).toBe("2 to scan");
  });
});
