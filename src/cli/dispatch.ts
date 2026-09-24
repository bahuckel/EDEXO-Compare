/**
 * What each command actually does.
 *
 * Kept apart from the readline loop so it can be tested without a terminal: every handler takes the
 * parsed arguments and a client, and returns lines to print. Nothing here writes to stdout.
 */
import { CliClient, describeFailure, normalizeTarget, type CliTarget } from "./client.js";
import { renderHelpIndex, renderHelpTopic, resolveCommand } from "./commands.js";

/** `hud` → `/hud-overlay.html`; a full path is taken as given. */
export function overlayPage(name: string): string {
  const raw = name.trim();
  if (!raw) return "/hud-overlay.html";
  if (raw.endsWith(".html")) return raw.startsWith("/") ? raw : `/${raw}`;
  return `/${raw.replace(/^\//, "").replace(/-overlay$/, "")}-overlay.html`;
}

/** `key=value key2=value2` into an object, with numbers and booleans read as themselves. */
export function parsePairs(args: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const a of args) {
    const eq = a.indexOf("=");
    if (eq <= 0) continue;
    const k = a.slice(0, eq);
    const v = a.slice(eq + 1);
    if (v === "true" || v === "false") out[k] = v === "true";
    else if (v !== "" && Number.isFinite(Number(v))) out[k] = Number(v);
    else out[k] = v;
  }
  return out;
}

/** The HUD's own section names, from `public/hud.js`. */
export const HUD_SECTIONS = ["jump", "fss", "candidates", "distance", "datavalue"];

const onOff = (args: string[]): boolean | null =>
  args[0] === "on" ? true : args[0] === "off" ? false : null;

export interface DispatchContext {
  client: CliClient;
  ownBase: string;
  /** Set by `quit`; the loop reads it and shuts down. */
  requestExit?: () => void;
}

const json = (v: unknown) => JSON.stringify(v, null, 2).split("\n");

/**
 * Run one line of input.
 *
 * Returns the lines to print. An unknown command is a suggestion, never a throw — a REPL that dies
 * on a typo is a REPL nobody keeps open.
 */
export async function dispatch(line: string, ctx: DispatchContext): Promise<string[]> {
  const trimmed = line.trim();
  if (!trimmed) return [];

  const hit = resolveCommand(trimmed);
  if (!hit) {
    return [`Unknown command: ${trimmed.split(/\s+/)[0]}`, "Type /help for the list."];
  }
  const { command, args } = hit;
  const { client } = ctx;
  const fail = (r: Awaited<ReturnType<CliClient["get"]>>) => [describeFailure(r, client.current)];

  switch (command.name) {
    case "help":
      return args.length ? renderHelpTopic(args.join(" ")) : renderHelpIndex();

    case "quit":
      ctx.requestExit?.();
      return ["Stopping."];

    case "status": {
      const r = await client.get("/api/state");
      if (!r.ok) return fail(r);
      const s = r.body as Record<string, unknown>;
      const n = (k: string) => (s[k] === undefined || s[k] === null ? "—" : String(s[k]));
      return [
        `commander   ${n("commanderName") || "—"}`,
        `system      ${n("currentSystem")}`,
        `journals    ${n("journalFileCount")} file(s) in ${n("journalDir")}`,
        `species     ${n("speciesCount")} loaded`,
        `bound       ${n("bindHost")}:${n("port")}  (${n("mode")})`,
      ];
    }

    case "refresh-exomastery": {
      const r = await client.post("/api/exomastery/reload");
      if (!r.ok) return fail(r);
      const b = r.body as { speciesDataDir?: string };
      return ["Reloaded.", `species read from ${b.speciesDataDir ?? "—"}`];
    }

    case "folder": {
      if (!args.length) {
        const r = await client.get("/api/state");
        if (!r.ok) return fail(r);
        const s = r.body as { journalDir?: string; journalDirConfiguredOk?: boolean };
        return [`${s.journalDir ?? "—"}${s.journalDirConfiguredOk === false ? "   (not readable)" : ""}`];
      }
      const r = await client.post("/api/settings/journal-directory", { journalDir: args.join(" ") });
      return r.ok ? ["Journal folder set."] : fail(r);
    }

    case "overlay": {
      const r = await client.get("/api/hud/overlay");
      if (!r.ok) return fail(r);
      const paths = (r.body as { paths?: string[] }).paths ?? [];
      return paths.length ? ["open:", ...paths.map((p) => `  ${p}`)] : ["No overlays open."];
    }

    case "overlay open":
    case "overlay toggle": {
      const verb = command.name.endsWith("open") ? "open" : "toggle";
      const [page, w, h] = args;
      const r = await client.post(`/api/hud/overlay/${verb}`, {
        pathname: overlayPage(page ?? ""),
        width: w ? Number(w) : undefined,
        height: h ? Number(h) : undefined,
      });
      if (!r.ok) return fail(r);
      /*
        Report what is on screen now rather than what was asked for. Opening a HUD that is already
        open reuses its window — the right behaviour, and "Opened" on its own made it look as though
        a second one had appeared.
      */
      const paths = (r.body as { result?: { paths?: string[] } }).result?.paths ?? [];
      return [
        `${verb === "open" ? "Opened" : "Toggled"} ${overlayPage(page ?? "")}`,
        paths.length ? `now open: ${paths.join(", ")}` : "nothing is open now",
      ];
    }

    case "overlay close": {
      if (!args[0]) return ["Which overlay? /overlay lists what is open."];
      const r = await client.post("/api/hud/overlay/close", { pathname: overlayPage(args[0]) });
      if (!r.ok) return fail(r);
      const closed = (r.body as { result?: { closed?: boolean } }).result?.closed;
      return [closed ? `Closed ${overlayPage(args[0])}` : "That overlay was not open."];
    }

    case "overlay sections": {
      if (!args[0])
        return [`Which sections? e.g. /overlay sections fss,jump`, `Known: ${HUD_SECTIONS.join(", ")}`];
      const asked = args
        .join(",")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      /*
        Check the names here rather than letting the page do it.

        `HUD.sectionsFromUrl` keeps only names it recognises, so one typo silently drops a section
        and a whole line of typos leaves the HUD blank with nothing to say why.
      */
      const unknown = asked.filter((s) => !HUD_SECTIONS.includes(s));
      if (unknown.length) {
        return [`No such section: ${unknown.join(", ")}`, `Known: ${HUD_SECTIONS.join(", ")}`];
      }
      /*
        The key is `s`, and it is the one the page actually reads — `?sections=` was ignored, and an
        unreadable query is not an error to `sectionsFromUrl`: it falls back to showing everything,
        so the command appeared to work while doing the opposite of what was asked.
      */
      const r = await client.post("/api/hud/overlay/set", {
        pathname: `/hud-overlay.html?s=${asked.join(",")}`,
      });
      return r.ok ? [`HUD now showing: ${asked.join(", ")}`] : fail(r);
    }

    case "overlay hide":
    case "overlay show": {
      const hidden = command.name.endsWith("hide");
      const r = await client.post("/api/hud/visibility", { hidden });
      return r.ok ? [hidden ? "Overlays hidden." : "Overlays shown."] : fail(r);
    }

    case "overlay layout": {
      if (!args.length) {
        const r = await client.get("/api/hud/layout");
        return r.ok ? json((r.body as { layout?: unknown }).layout) : fail(r);
      }
      const r = await client.post("/api/hud/layout", parsePairs(args));
      return r.ok ? json((r.body as { layout?: unknown }).layout) : fail(r);
    }

    case "overlay radar": {
      // `radarRadius` on the snapshot, not a HUD preference — it carries its own bounds so the
      // launcher cannot offer a value the server would clamp, and this prints them for the same reason.
      const readRadius = async () => {
        // `/api/status`, not `/api/state`: the snapshot the launcher polls is where the DTO lives.
        const r = await client.get("/api/status");
        if (!r.ok) return { lines: fail(r), dto: null };
        const dto = (r.body as { radarRadius?: { radiusM?: number; minM?: number; maxM?: number } })
          .radarRadius;
        return { lines: null, dto: dto ?? null };
      };

      if (!args.length) {
        const { lines, dto } = await readRadius();
        if (lines) return lines;
        if (!dto) return ["This instance does not report a radar radius."];
        return [`radar radius: ${dto.radiusM} m   (${dto.minM}–${dto.maxM} m allowed)`];
      }
      const radiusM = Number(args[0]);
      if (!Number.isFinite(radiusM)) return ["Radius must be a number of metres."];
      const r = await client.post("/api/settings/radar-radius", { radiusM });
      if (!r.ok) return fail(r);
      const applied = (r.body as { radiusM?: number }).radiusM;
      const note = applied !== radiusM ? `   (asked for ${radiusM}, clamped)` : "";
      return [`radar radius: ${String(applied)} m${note}`];
    }

    case "overlay prefs": {
      if (!args.length) {
        const r = await client.get("/api/state");
        if (!r.ok) return fail(r);
        return json((r.body as { hudPrefs?: unknown }).hudPrefs ?? {});
      }
      const r = await client.post("/api/settings/hud-prefs", parsePairs(args));
      return r.ok ? ["HUD preferences updated."] : fail(r);
    }

    case "import dump": {
      const apply = args.includes("--apply");
      const file = args.filter((a) => a !== "--apply").join(" ");
      if (!file) return ["Which file? /import dump <path> [--apply]"];
      const r = await client.post("/api/feeder/import-dump", { file, apply });
      if (!r.ok) return fail(r);
      return [
        apply ? "Import started." : "Dry run started — nothing will be written.",
        "Watch it with /import status.",
      ];
    }

    case "import status": {
      const r = await client.get("/api/feeder/import-dump/status");
      return r.ok ? json(r.body) : fail(r);
    }

    case "import routes": {
      if (!args.length) return ["Which file? /import routes <path>"];
      const r = await client.post("/api/feeder/import", { file: args.join(" ") });
      return r.ok ? ["Route import started."] : fail(r);
    }

    case "import feeder-dir": {
      if (!args.length) {
        const r = await client.get("/api/feeder/status");
        return r.ok ? json(r.body) : fail(r);
      }
      const r = await client.post("/api/settings/feeder-data-directory", { feederDataDir: args.join(" ") });
      return r.ok ? ["Feeder directory set."] : fail(r);
    }

    case "network": {
      const r = await client.get("/api/state");
      if (!r.ok) return fail(r);
      const s = r.body as { bindHost?: string; port?: number; lanUrls?: string[]; mode?: string };
      const out = [
        `target      ${client.current.base}${client.current.own ? "   (this console's own server)" : ""}`,
        `bound       ${s.bindHost}:${s.port}  (${s.mode})`,
      ];
      if (s.lanUrls?.length) out.push("on the LAN:", ...s.lanUrls.map((u) => `  ${u}`));
      else out.push("LAN        off — this instance is loopback only");
      return out;
    }

    case "network connect": {
      if (!args.length) {
        client.setTarget({ base: ctx.ownBase, own: true });
        return [`Back on this console's own server: ${ctx.ownBase}`];
      }
      const base = normalizeTarget(args[0]!);
      if (!base) return ["Where to? /network connect 127.0.0.1:7111"];
      const next: CliTarget = { base, own: base === ctx.ownBase, key: args[1] };
      const probe = new CliClient(next);
      const r = await probe.get("/api/state");
      if (!r.ok) return [describeFailure(r, next)];
      client.setTarget(next);
      const s = r.body as { mode?: string; speciesCount?: number };
      return [`Connected to ${base} (${s.mode ?? "?"}, ${s.speciesCount ?? 0} species).`];
    }

    case "network edsm":
    case "network edsm-upload":
    case "network canonn":
    case "network eddn": {
      const path =
        command.name === "network edsm"
          ? "/api/settings/edsm-auto-fetch"
          : command.name === "network edsm-upload"
            ? "/api/settings/edsm-upload"
            : command.name === "network eddn"
              ? "/api/settings/eddn-upload"
              : "/api/settings/canonn-upload";
      const want = onOff(args);
      if (want === null) {
        const r = await client.get("/api/state");
        if (!r.ok) return fail(r);
        const s = r.body as Record<string, { enabled?: boolean } | boolean | undefined>;
        const key =
          command.name === "network edsm"
            ? "edsmAutoFetch"
            : command.name === "network edsm-upload"
              ? "edsmUpload"
              : command.name === "network eddn"
                ? "eddnUpload"
                : "canonnUpload";
        const v = s[key];
        const enabled = typeof v === "object" && v ? v.enabled : v;
        return [`${key}: ${enabled ? "on" : "off"}`];
      }
      const r = await client.post(path, { enabled: want });
      return r.ok ? [`${command.name.replace("network ", "")}: ${want ? "on" : "off"}`] : fail(r);
    }

    default:
      return [`${command.name} is described in /help but not wired up yet.`];
  }
}
