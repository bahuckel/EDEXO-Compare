/**
 * The galaxy map's menus, in the game's own manner (owner, 2026-10-04, after the in-game comms panel):
 * a row of icon tabs at the top left, and under the open one a list of rows — the label on the left,
 * its value in a box on the right, the row lit when the pointer is on it. Every tab and row explains
 * itself on hover, and each menu has a [?] for the longer story.
 */
import type { ReactNode } from "react";
import { InfoPopover, Tooltip } from "../ui/Tooltip";

export type G3dTabKey = "view" | "layers" | "filter" | "search" | "navroute" | "codex" | "targets";

export const G3D_TABS: { key: G3dTabKey; label: string; hint: string }[] = [
  { key: "view", label: "View", hint: "View: camera, follow your ship, colours, brightness" },
  { key: "layers", label: "Layers", hint: "Layers: your systems, borders, names, points of interest, carriers, bookmarks…" },
  { key: "filter", label: "Filter", hint: "Filter: light the systems with a star, a planet type or a plant you pick" },
  { key: "search", label: "Search", hint: "Species search: where a species has been recorded, nearest first" },
  { key: "navroute", label: "NavRoute", hint: "NavRoute: the star types along the routes you plotted in the game" },
  { key: "codex", label: "Codex", hint: "Codex: what you have logged, region by region" },
  { key: "targets", label: "Targets", hint: "Biology targets: the nearest system worth flying to, and a plan of several" },
];

export const G3D_HELP: Record<G3dTabKey, string[]> = {
  view: [
    "Top looks straight down on the galaxy, Tilt across it at an angle. Core flies to Sagittarius A*, Sol home, Me to your ship.",
    "Follow my ship keeps the camera on you: each jump moves it with you, at the distance you were looking from.",
    "Colour by Evidence shows how sure each record is — mapped with a DSS, codex logged, or signals only. Species count and Value show how rich a system is.",
    "With the mouse: left drag pans, right drag tilts and turns, the wheel zooms. Click a ring to open a group, a dot to open a system.",
  ],
  layers: [
    "What is drawn over the 5.3 million systems. Your systems: amber where signals still wait for you, green where you mapped or sampled, grey where you only passed through.",
    "Region borders and names, the groups that stand for many systems when zoomed out, and the Milky Way photograph behind them.",
    "Points of interest, notable phenomena, fleet carriers, your bookmarks and green gas giants come from lists already on this PC; a layer that needs a download says so.",
  ],
  filter: [
    "Tick what you are after — a star class, a planet type, a genus or a species — and the systems that have it light up while the rest dim. Several ticks in one group mean any of them; across groups, all of them.",
    "Star and planet types come from Spansh's galaxy dump; the plants from EDAstro's codex records.",
  ],
  search: [
    "Where has a species been recorded? Pick one, or a minimum value, and the map shows the systems where commanders logged it, nearest first.",
    "These are recorded sightings, not the app's predictions.",
  ],
  navroute: [
    "Every route you plot in the game's galaxy map is kept here with each system's star class — a free survey of the star types along the way, whether you fly it or not.",
    "Pick a star type to find neutron stars, Wolf-Rayets or black holes. Check EDSM asks which of them EDSM knows: one it does not is a system nobody has reported. ☆ keeps one as a bookmark.",
  ],
  codex: [
    "Your codex, region by region: how many of a region's entries you have logged. Click a region on the map or in the list to see its systems.",
  ],
  targets: [
    "For exobiology runs. Set a floor and Next target finds the nearest system worth at least that much that you have not mapped or sampled, flies there and copies its name for the game's galaxy map.",
    "Plan adds more stops, each the nearest worthwhile system to the last, and visits them in the shortest order it finds — back to where you started, if you tick Back to start.",
    "Values are the recorded species at 1×: these systems come from other commanders' records, so the first footfall is most likely gone.",
  ],
};

/** A menu's title row with its [?]. */
export function MenuHead({ title, help }: { title: string; help: string[] }) {
  return (
    <div className="g3d-menu__head">
      <span>{title}</span>
      <InfoPopover title={title} label={`About ${title}`}>
        {help.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </InfoPopover>
    </div>
  );
}

/** One row: the label (with its hover explanation) on the left, the control on the right. */
export function MenuRow({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="g3d-row">
      <Tooltip text={hint} className="g3d-row__label">
        <span>{label}</span>
      </Tooltip>
      <span className="g3d-row__ctl">{children}</span>
    </div>
  );
}

/** An on / off row, a checkbox under the game-style value box. */
export function MenuToggle({ label, hint, on, set }: { label: string; hint: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <label className="g3d-row g3d-row--check">
      <input type="checkbox" className="g3d-row__box" checked={on} onChange={(ev) => set(ev.target.checked)} />
      <Tooltip text={hint} className="g3d-row__label">
        <span>{label}</span>
      </Tooltip>
      <span className="g3d-row__val">{on ? "On" : "Off"}</span>
    </label>
  );
}

/** The tab icons: drawn, 24 × 24, in the current colour. */
export function G3dIcon({ name }: { name: G3dTabKey }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return (
    <svg className="g3d-tab__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {name === "view" ? (
        <>
          <path {...p} d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
          <circle {...p} cx="12" cy="12" r="3" />
        </>
      ) : name === "layers" ? (
        <>
          <path {...p} d="M12 3 2.5 8 12 13l9.5-5L12 3z" />
          <path {...p} d="m2.5 12.5 9.5 5 9.5-5" />
          <path {...p} d="m2.5 16.5 9.5 5 9.5-5" />
        </>
      ) : name === "filter" ? (
        <path {...p} d="M3 4.5h18l-7 8.5v6l-4 1.5V13L3 4.5z" />
      ) : name === "search" ? (
        <>
          <circle {...p} cx="10.5" cy="10.5" r="6.5" />
          <path {...p} d="m15.5 15.5 5.5 5.5" />
          <path {...p} d="M10.5 7.5c-1.8 1-2.2 3-1 4.8 1.6-.4 2.6-2.4 1-4.8z" />
        </>
      ) : name === "navroute" ? (
        <>
          <circle {...p} cx="5" cy="18" r="2" />
          <circle {...p} cx="12" cy="9" r="2" />
          <circle {...p} cx="19" cy="5" r="2" />
          <path {...p} d="m6.3 16.4 4.4-5.8M13.8 8l3.4-2" />
        </>
      ) : name === "codex" ? (
        <>
          <path {...p} d="M4 4.5h6.5A2.5 2.5 0 0 1 13 7v13a2 2 0 0 0-2-2H4V4.5z" />
          <path {...p} d="M20 4.5h-4.5A2.5 2.5 0 0 0 13 7v13a2 2 0 0 1 2-2h5V4.5z" />
        </>
      ) : (
        <>
          <circle {...p} cx="12" cy="12" r="8" />
          <circle {...p} cx="12" cy="12" r="3" />
          <path {...p} d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4" />
        </>
      )}
    </svg>
  );
}
