/**
 * Every command the console build understands, and the help that describes them.
 *
 * One table, read by both the dispatcher and `/help`, because a command list that lives separately
 * from the commands is a list that goes stale — and the only person who finds out is someone typing
 * a command that no longer exists.
 *
 * Commands are grouped into **topics** so `/help` stays short. `/help` alone prints the topics with
 * a line each; `/help overlay` prints that topic in full. The topic names are the ones the commander
 * asked for: `overlay`, `import`, `network`, `refresh-exomastery`, plus `folder` and `app`.
 */

export interface CommandSpec {
  /** What is typed, without the leading slash: `overlay open`. */
  name: string;
  /** Argument sketch shown after the name, e.g. `<page> [width] [height]`. */
  args?: string;
  /** One line. Present tense, says what happens. */
  summary: string;
  /** Extra paragraphs for the topic view — the things that surprise people. */
  detail?: string[];
  /** True when it needs the desktop app: overlay windows are Electron's, not the server's. */
  needsDesktop?: boolean;
}

export interface TopicSpec {
  name: string;
  /** Shown beside the topic in `/help`. */
  summary: string;
  /** Opening paragraph for `/help <topic>`. */
  intro?: string;
  commands: CommandSpec[];
}

export const TOPICS: TopicSpec[] = [
  {
    name: "overlay",
    summary: "HUD overlay windows: open, close, lay out, hide",
    intro:
      "Overlay windows belong to the desktop app, not to the server. From a console build these " +
      "commands need --connect pointed at a running EDExoCompare.exe; without one they answer with " +
      "exactly that rather than failing quietly.",
    commands: [
      { name: "overlay", summary: "List the overlays that are open right now.", needsDesktop: true },
      {
        name: "overlay open",
        args: "<page> [width] [height]",
        summary: "Open an overlay window.",
        detail: [
          "Pages are the overlay HTML files: hud, distance, foot, radar — a bare name is resolved to " +
            "/<name>-overlay.html, and a full /path.html is taken as given.",
          "Size defaults to 404x330, the same defaults the app's own buttons use.",
        ],
        needsDesktop: true,
      },
      {
        name: "overlay toggle",
        args: "<page>",
        summary: "Open it if closed, close it if open.",
        needsDesktop: true,
      },
      { name: "overlay close", args: "<page>", summary: "Close one overlay window.", needsDesktop: true },
      {
        name: "overlay sections",
        args: "<a,b,c>",
        summary: "Choose what the merged HUD shows, without reopening it.",
        detail: [
          "jump, fss, candidates, distance, datavalue. A name the HUD does not know is refused here " +
            "rather than dropped silently by the page.",
          "The open window navigates rather than closing and reopening, so it does not blink.",
        ],
        needsDesktop: true,
      },
      { name: "overlay hide", summary: "Hide every overlay, keeping them open.", needsDesktop: true },
      { name: "overlay show", summary: "Show them again.", needsDesktop: true },
      {
        name: "overlay layout",
        args: "[key=value ...]",
        summary: "Print the layout, or change corner, scale and spacing.",
        needsDesktop: true,
      },
      { name: "overlay radar", args: "[metres]", summary: "Print or set the radar radius." },
      {
        name: "overlay prefs",
        args: "[key=value ...]",
        summary: "Print or change the stored HUD preferences.",
      },
    ],
  },
  {
    name: "import",
    summary: "Spansh dumps and route exports into the local corpus",
    intro:
      "Imports run on the server and can take a long while on a full galaxy dump. Start one, then " +
      "watch it with import status — the console stays usable while it runs.",
    commands: [
      {
        name: "import dump",
        args: "<file> [--apply]",
        summary: "Import a Spansh galaxy dump.",
        detail: [
          "Without --apply this is a dry run: it reports what it would change and writes nothing.",
          "The file is read by the server, so the path must make sense to the machine running it.",
        ],
      },
      { name: "import status", summary: "How the running import is doing, or how the last one ended." },
      {
        name: "import routes",
        args: "<file>",
        summary: "Import a Spansh route export (the exobiology CSV/JSON).",
      },
      { name: "import feeder-dir", args: "[path]", summary: "Print or set where feeder data is kept." },
    ],
  },
  {
    name: "network",
    summary: "Which address it serves on, who may reach it, EDSM and Canonn",
    intro:
      "The bind address and port are chosen at launch, not at runtime: --local for this PC only, " +
      "--lan or --host for the network, --port to move it off 7111 so a second instance can run " +
      "beside the first. network prints what the running instance actually did, which is the thing " +
      "worth checking.",
    commands: [
      {
        name: "network",
        summary: "Bind address, port, LAN links and where the access key lives.",
        detail: [
          "Every device that is not this PC needs the ?k= key from those links. Delete the key file " +
            "to un-pair all of them.",
        ],
      },
      {
        name: "network connect",
        args: "<host[:port]>",
        summary: "Point this console at another instance — usually the desktop app.",
        detail: [
          "Use this to drive the running EDExoCompare.exe from a terminal: connect 127.0.0.1:7111.",
          "connect with no argument goes back to the server this console started.",
        ],
      },
      { name: "network edsm", args: "[on|off]", summary: "Print or switch EDSM auto-fetch." },
      {
        name: "network edsm-upload",
        args: "[on|off]",
        summary: "Print or switch uploading your scans to EDSM.",
      },
      { name: "network canonn", args: "[on|off]", summary: "Print or switch uploading to Canonn Research." },
    ],
  },
  {
    name: "refresh-exomastery",
    summary: "Re-read the species tree and drop the profile cache",
    intro:
      "Use it after dropping new exomastery files into data/species; nothing needs restarting. The " +
      "reply names the species directory it actually read, which is the fastest way to find out " +
      "that an overlay folder is not where you thought.",
    commands: [
      { name: "refresh-exomastery", summary: "Reload the species database and clear the exomastery cache." },
    ],
  },
  {
    name: "folder",
    summary: "Where the journals are read from",
    commands: [
      {
        name: "folder",
        args: "[path]",
        summary: "Print or set the journal folder.",
        detail: [
          "The preference is stored beside your settings in %LOCALAPPDATA%, so it survives updates.",
          "ED_JOURNAL_DIR in the environment beats it, which is what an isolated test run uses.",
        ],
      },
    ],
  },
  {
    name: "app",
    summary: "Status, and leaving",
    commands: [
      { name: "status", summary: "Commander, system, journal count and what is loaded." },
      { name: "help", args: "[topic]", summary: "This. A topic name prints that topic in full." },
      { name: "quit", summary: "Stop the server this console started and exit." },
    ],
  },
];

/** Every command, flattened. */
export function allCommands(): CommandSpec[] {
  return TOPICS.flatMap((t) => t.commands);
}

/** The topic a command belongs to, or null for a name nothing defines. */
export function topicForCommand(name: string): TopicSpec | null {
  return TOPICS.find((t) => t.commands.some((c) => c.name === name)) ?? null;
}

/**
 * Resolve typed input to a command, longest name first.
 *
 * `overlay open hud` must find `overlay open` and not `overlay`, so matching walks from the most
 * specific name down. Returns the command and whatever words were left over as arguments.
 */
export function resolveCommand(input: string): { command: CommandSpec; args: string[] } | null {
  const words = input.trim().replace(/^\//, "").split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const names = allCommands()
    .map((c) => c.name)
    .sort((a, b) => b.split(" ").length - a.split(" ").length);
  for (const name of names) {
    const parts = name.split(" ");
    if (parts.every((p, i) => words[i]?.toLowerCase() === p)) {
      const command = allCommands().find((c) => c.name === name)!;
      return { command, args: words.slice(parts.length) };
    }
  }
  return null;
}

const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length));

/** `/help` with no topic: the topics, and the handful of commands worth seeing immediately. */
export function renderHelpIndex(): string[] {
  const width = Math.max(...TOPICS.map((t) => t.name.length)) + 2;
  const out = ["Commands are grouped by topic. /help <topic> prints one in full.", ""];
  for (const t of TOPICS) out.push(`  /help ${pad(t.name, width)} ${t.summary}`);
  out.push("");
  out.push("  Anything here works with or without the leading slash.");
  return out;
}

/** `/help <topic>`. Unknown topics come back as a suggestion rather than an error. */
export function renderHelpTopic(name: string): string[] {
  const key = name.trim().toLowerCase().replace(/^\//, "");
  const topic = TOPICS.find((t) => t.name === key);
  if (!topic) {
    const near = TOPICS.map((t) => t.name).filter((n) => n.startsWith(key.slice(0, 3)));
    return [
      `No topic called "${name}".`,
      near.length ? `Did you mean: ${near.join(", ")}?` : `Topics: ${TOPICS.map((t) => t.name).join(", ")}`,
    ];
  }

  const out = [`${topic.name} — ${topic.summary}`, ""];
  if (topic.intro) out.push(...wrap(topic.intro, 96).map((l) => `  ${l}`), "");

  const width = Math.max(...topic.commands.map((c) => `/${c.name} ${c.args ?? ""}`.trimEnd().length)) + 2;
  for (const c of topic.commands) {
    const sig = `/${c.name}${c.args ? ` ${c.args}` : ""}`;
    out.push(`  ${pad(sig, width)} ${c.summary}${c.needsDesktop ? "  [desktop app]" : ""}`);
    for (const d of c.detail ?? []) out.push(...wrap(d, 88).map((l) => `  ${" ".repeat(width)} ${l}`));
  }
  if (topic.commands.some((c) => c.needsDesktop)) {
    out.push("", "  [desktop app] — needs a running EDExoCompare.exe; see /help network, connect.");
  }
  return out;
}

/** Break a paragraph on spaces. No hyphenation: a wrapped path should stay copy-pasteable. */
export function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line && line.length + 1 + w.length > width) {
      lines.push(line);
      line = w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) lines.push(line);
  return lines;
}
