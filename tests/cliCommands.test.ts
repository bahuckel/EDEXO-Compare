/**
 * The console's command table, and the help built from it.
 *
 * The table is the only description of what the CLI understands. A command the dispatcher handles
 * but the table omits is invisible; a command the table advertises but the dispatcher does not
 * handle is a promise the program breaks when someone types it. Both are checked here.
 */
import { describe, expect, it } from "vitest";
import {
  TOPICS,
  allCommands,
  renderHelpIndex,
  renderHelpTopic,
  resolveCommand,
  topicForCommand,
  wrap,
} from "../src/cli/commands.js";
import { overlayPage, parsePairs } from "../src/cli/dispatch.js";
import { normalizeTarget } from "../src/cli/client.js";
import { bannerLines, BYLINE } from "../src/cli/banner.js";
import { shouldStartRepl } from "../src/cli/repl.js";

describe("resolving what was typed", () => {
  it("prefers the longest matching name", () => {
    /*
      THE ONE THAT MATTERS. `overlay` and `overlay open` both exist, and a first-match walk would
      make `/overlay open hud` mean "list the overlays" with two stray arguments — a command that
      silently does the wrong thing rather than failing.
    */
    expect(resolveCommand("/overlay open hud")?.command.name).toBe("overlay open");
    expect(resolveCommand("/overlay open hud")?.args).toEqual(["hud"]);
    expect(resolveCommand("/overlay")?.command.name).toBe("overlay");
    expect(resolveCommand("/overlay")?.args).toEqual([]);
  });

  it("takes a command with or without the slash, in any case", () => {
    expect(resolveCommand("help")?.command.name).toBe("help");
    expect(resolveCommand("/HELP overlay")?.command.name).toBe("help");
    expect(resolveCommand("  /import   status  ")?.command.name).toBe("import status");
  });

  it("returns null for something nothing defines, rather than guessing", () => {
    expect(resolveCommand("/wibble")).toBeNull();
    expect(resolveCommand("")).toBeNull();
  });
});

describe("the table itself", () => {
  it("names every topic the commander asked for", () => {
    const names = TOPICS.map((t) => t.name);
    for (const asked of ["overlay", "import", "network", "refresh-exomastery"]) {
      expect(names, `/help ${asked} must exist`).toContain(asked);
    }
  });

  it("has no duplicate command names", () => {
    const names = allCommands().map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("puts every command in exactly one topic", () => {
    for (const c of allCommands()) expect(topicForCommand(c.name), c.name).not.toBeNull();
  });

  it("gives every command a summary that reads as a sentence", () => {
    for (const c of allCommands()) {
      expect(c.summary.length, c.name).toBeGreaterThan(10);
      expect(c.summary.endsWith("."), `${c.name}: "${c.summary}"`).toBe(true);
    }
  });
});

describe("help", () => {
  it("lists every topic in the index", () => {
    const text = renderHelpIndex().join("\n");
    for (const t of TOPICS) expect(text).toContain(`/help ${t.name}`);
  });

  it("prints a topic's commands in full", () => {
    const text = renderHelpTopic("overlay").join("\n");
    expect(text).toContain("/overlay open");
    expect(text).toContain("/overlay close");
    expect(text).toContain("[desktop app]");
  });

  it("answers an unknown topic with a suggestion, not an error", () => {
    const text = renderHelpTopic("netwrk").join("\n");
    expect(text).toContain("No topic");
    expect(text).toMatch(/network/);
  });

  it("wraps on spaces without breaking a path", () => {
    const lines = wrap("keep C:\\Users\\Someone\\Saved Games intact when wrapping this sentence", 20);
    expect(lines.some((l) => l.includes("C:\\Users\\Someone\\Saved"))).toBe(true);
    expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(45);
  });
});

describe("the banner", () => {
  it("spells EDEXO in block characters with the byline under it in ordinary letters", () => {
    const lines = bannerLines({ colour: false });
    expect(lines.slice(0, 5).every((l) => l.includes("█"))).toBe(true);
    expect(lines.join("\n")).toContain(BYLINE);
    expect(BYLINE).toBe("By CMDR FALrenica");
    // The byline must not be drawn in blocks — that was the whole point of it being underneath.
    expect(lines.find((l) => l.includes(BYLINE))!.includes("█")).toBe(false);
  });

  it("points at /help, which is how anyone finds the rest", () => {
    expect(bannerLines({ colour: false }).join("\n")).toContain("/help");
  });
});

describe("argument reading", () => {
  it("turns a bare overlay name into its page", () => {
    expect(overlayPage("hud")).toBe("/hud-overlay.html");
    expect(overlayPage("distance")).toBe("/distance-overlay.html");
    // Already-suffixed and full paths must not be doubled up.
    expect(overlayPage("radar-overlay")).toBe("/radar-overlay.html");
    expect(overlayPage("/hud-overlay.html")).toBe("/hud-overlay.html");
  });

  it("reads key=value pairs as the types they look like", () => {
    expect(parsePairs(["scale=1.25", "corner=tl", "hidden=true"])).toEqual({
      scale: 1.25,
      corner: "tl",
      hidden: true,
    });
    expect(parsePairs(["nonsense", "=x"])).toEqual({});
  });

  it("fills in the obvious parts of a connect target", () => {
    expect(normalizeTarget("7111")).toBe("http://127.0.0.1:7111");
    expect(normalizeTarget("127.0.0.1:7111")).toBe("http://127.0.0.1:7111");
    expect(normalizeTarget("gamebox")).toBe("http://gamebox:7111");
    expect(normalizeTarget("http://gamebox:9000/")).toBe("http://gamebox:9000");
  });
});

describe("when the prompt should appear at all", () => {
  it("stays out of Electron and out of a pipe", () => {
    /*
      The console builds are run headless as a background server too. Writing "edexo> " into a
      redirected stream, or into Electron's stdout, would be a regression for anyone doing that.
    */
    const tty = { isTTY: true };
    const pipe = { isTTY: false };
    expect(shouldStartRepl({}, tty, tty)).toBe(true);
    expect(shouldStartRepl({ EDEXO_ELECTRON: "1" }, tty, tty)).toBe(false);
    expect(shouldStartRepl({ EDEXO_NO_REPL: "1" }, tty, tty)).toBe(false);
    expect(shouldStartRepl({}, pipe, tty)).toBe(false);
    expect(shouldStartRepl({}, tty, pipe), "a redirected stdout gets no prompt either").toBe(false);
  });
});
