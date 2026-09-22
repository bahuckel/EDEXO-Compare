/**
 * What the console does with an answer, especially an unhelpful one.
 *
 * The happy paths are thin wrappers over HTTP. The paths worth pinning are the failures: a command
 * typed at a build that cannot do it, a target that is not listening, and a typo. All three are
 * things a commander will hit in the first minute, and all three used to be "nothing happens".
 */
import { describe, expect, it, vi } from "vitest";
import { CliClient } from "../src/cli/client.js";
import { dispatch } from "../src/cli/dispatch.js";

/** A fetch that answers from a table of `METHOD path` → `[status, body]`. */
function fakeFetch(routes: Record<string, [number, unknown]>) {
  const seen: { method: string; path: string; body: unknown }[] = [];
  const impl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? "GET";
    seen.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const [status, body] = routes[`${method} ${path}`] ?? [404, { error: "no such route" }];
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  });
  return { impl: impl as unknown as typeof fetch, seen };
}

const run = (line: string, routes: Record<string, [number, unknown]>) => {
  const f = fakeFetch(routes);
  const client = new CliClient({ base: "http://127.0.0.1:7111", own: true }, f.impl);
  return dispatch(line, { client, ownBase: "http://127.0.0.1:7111" }).then((lines) => ({
    text: lines.join("\n"),
    seen: f.seen,
  }));
};

describe("when the build cannot do it", () => {
  it("prints the server's own reason for a 501 rather than a generic failure", async () => {
    /*
      THE ONE THAT MATTERS. Overlay windows are Electron's, so a console build answers 501 with an
      explanation naming the fix. Swallowing that and printing "failed" would leave someone retyping
      a command that can never work here.
    */
    const { text } = await run("/overlay open hud", {
      "POST /api/hud/overlay/open": [
        501,
        {
          ok: false,
          error: "Overlay windows need the desktop app. Start EDExoCompare.exe, or --connect to it.",
        },
      ],
    });
    expect(text).toContain("need the desktop app");
  });

  it("says where to point it when the target is not listening", async () => {
    const f = fakeFetch({});
    const throwing = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const client = new CliClient({ base: "http://127.0.0.1:9999", own: false }, throwing);
    const lines = await dispatch("/status", { client, ownBase: "http://127.0.0.1:7111" });
    expect(lines.join("\n")).toContain("Cannot reach http://127.0.0.1:9999");
    expect(lines.join("\n"), "and how to get back").toContain("/network connect");
    expect(f.seen).toHaveLength(0);
  });

  it("answers a typo with the help pointer instead of a stack", async () => {
    const { text } = await run("/overlya open", {});
    expect(text).toContain("Unknown command");
    expect(text).toContain("/help");
  });
});

describe("the commands that change something", () => {
  it("sends the journal folder as the server expects it", async () => {
    const { seen } = await run("/folder D:\\Elite\\Journals", {
      "POST /api/settings/journal-directory": [200, { ok: true }],
    });
    expect(seen[0]).toMatchObject({
      method: "POST",
      path: "/api/settings/journal-directory",
      body: { journalDir: "D:\\Elite\\Journals" },
    });
  });

  it("treats an import without --apply as a dry run, and says so", async () => {
    const { text, seen } = await run("/import dump F:\\spansh\\galaxy.json.gz", {
      "POST /api/feeder/import-dump": [200, { ok: true }],
    });
    expect(seen[0]!.body).toMatchObject({ file: "F:\\spansh\\galaxy.json.gz", apply: false });
    expect(text).toContain("nothing will be written");
  });

  it("passes --apply through without letting it become part of the filename", async () => {
    const { seen } = await run("/import dump F:\\spansh\\galaxy.json.gz --apply", {
      "POST /api/feeder/import-dump": [200, { ok: true }],
    });
    expect(seen[0]!.body).toMatchObject({ file: "F:\\spansh\\galaxy.json.gz", apply: true });
  });

  it("refuses a radar radius that is not a number, without calling the server", async () => {
    const { text, seen } = await run("/overlay radar wide", {});
    expect(text).toContain("must be a number");
    expect(seen).toHaveLength(0);
  });

  it("reports what reloading exomastery actually read", async () => {
    const { text } = await run("/refresh-exomastery", {
      "POST /api/exomastery/reload": [200, { ok: true, speciesDataDir: "C:\\app\\data\\species" }],
    });
    expect(text).toContain("C:\\app\\data\\species");
  });
});

describe("attaching to another instance", () => {
  it("only switches after the other end answers", async () => {
    /*
      A connect that moved the target first and asked later would leave every following command
      pointed at nothing, with the reason for the original failure already scrolled away.
    */
    const throwing = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const client = new CliClient({ base: "http://127.0.0.1:7111", own: true }, throwing);
    const lines = await dispatch("/network connect 127.0.0.1:7999", {
      client,
      ownBase: "http://127.0.0.1:7111",
    });
    expect(lines.join("\n")).toContain("Cannot reach http://127.0.0.1:7999");
    expect(client.current.base, "target unchanged after a failed connect").toBe("http://127.0.0.1:7111");
  });

  it("goes back to its own server when told to connect to nothing", async () => {
    const f = fakeFetch({});
    const client = new CliClient({ base: "http://elsewhere:7111", own: false }, f.impl);
    await dispatch("/network connect", { client, ownBase: "http://127.0.0.1:7111" });
    expect(client.current).toMatchObject({ base: "http://127.0.0.1:7111", own: true });
  });
});

describe("the overlay commands, as the app actually reads them", () => {
  it("sets HUD sections with the key the page reads", async () => {
    /*
      THE ONE THAT MATTERS HERE. `hud.js` reads `?s=`; `?sections=` is not an error to it — with no
      `s` in the query `sectionsFromUrl` falls back to **every** section. So the wrong key made the
      command report success while doing the opposite of what was asked, on a real HUD window.
    */
    const { text, seen } = await run("/overlay sections fss,jump", {
      "POST /api/hud/overlay/set": [200, { ok: true, result: { paths: [] } }],
    });
    expect(seen[0]!.body).toMatchObject({ pathname: "/hud-overlay.html?s=fss,jump" });
    expect(text).toContain("fss, jump");
  });

  it("refuses a section the HUD does not know, rather than letting the page drop it", async () => {
    const { text, seen } = await run("/overlay sections wibble", {});
    expect(text).toContain("No such section");
    expect(text).toContain("datavalue");
    expect(seen, "nothing sent").toHaveLength(0);
  });

  it("reads the radar radius from the snapshot that carries it", async () => {
    // `/api/status`, not `/api/state`: the field was invented on the wrong payload and always
    // printed an em dash, while setting it worked — the reading half was silently useless.
    const { text, seen } = await run("/overlay radar", {
      "GET /api/status": [200, { radarRadius: { radiusM: 750, minM: 250, maxM: 2000 } }],
    });
    expect(seen[0]!.path).toBe("/api/status");
    expect(text).toContain("750 m");
    expect(text, "the bounds, so nobody asks for a value the server will clamp").toContain("250–2000");
  });

  it("says so when the server clamped what was asked for", async () => {
    const { text } = await run("/overlay radar 99999", {
      "POST /api/settings/radar-radius": [200, { ok: true, radiusM: 2000 }],
    });
    expect(text).toContain("2000 m");
    expect(text).toContain("clamped");
  });

  it("reports what is open after opening, not what was requested", async () => {
    // Opening a HUD that is already open reuses its window. "Opened" alone read as though a second
    // one had appeared.
    const { text } = await run("/overlay open distance", {
      "POST /api/hud/overlay/open": [
        200,
        {
          ok: true,
          result: { opened: true, paths: ["/hud-overlay.html?s=fss,jump", "/distance-overlay.html"] },
        },
      ],
    });
    expect(text).toContain("now open:");
    expect(text).toContain("/hud-overlay.html?s=fss,jump");
  });
});
