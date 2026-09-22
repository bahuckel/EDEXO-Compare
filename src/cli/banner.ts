/**
 * What the console builds print on startup.
 *
 * The exes used to open with a line about which port they bound and nothing else, which is a fine
 * log line and a poor front door: nothing said what the program was, who made it, or that there was
 * anything to type at it.
 *
 * Block characters rather than an ASCII-art font, because every Windows console since Windows 8
 * renders U+2588 in the default font and slanted `/\` lettering stops being readable the moment the
 * window is narrow.
 */

/** `EDEXO` at five rows. Five-wide glyphs, one blank column between them. */
const EDEXO = [
  "█████ ████  █████ █   █  ███ ",
  "█     █   █ █      █ █  █   █",
  "████  █   █ ████    █   █   █",
  "█     █   █ █      █ █  █   █",
  "█████ ████  █████ █   █  ███ ",
];

/**
 * The byline, in ordinary letters on purpose.
 *
 * Spelled the way the commander spells it everywhere else in the project — `photo-credits.json`,
 * `NOTICE.md`, the README — so a credit is one string across the whole app rather than three
 * near-misses.
 */
export const BYLINE = "By CMDR FALrenica";

export interface BannerOptions {
  version?: string;
  /** Where commands are going: the instance this console started, or one it attached to. */
  target?: string;
  /** False for a pipe or a log file, where box characters are noise. */
  colour?: boolean;
}

const DIM = "[2m";
const BOLD = "[1m";
const RESET = "[0m";

/** The startup banner, as lines. Returned rather than printed so a test can read it. */
export function bannerLines(opts: BannerOptions = {}): string[] {
  const colour = opts.colour ?? true;
  const bold = (s: string) => (colour ? `${BOLD}${s}${RESET}` : s);
  const dim = (s: string) => (colour ? `${DIM}${s}${RESET}` : s);

  const out = EDEXO.map(bold);
  out.push("");
  out.push(`  ${BYLINE}${opts.version ? dim(`   v${opts.version}`) : ""}`);
  if (opts.target) out.push(dim(`  talking to ${opts.target}`));
  out.push("");
  out.push(`  ${dim("Type")} /help ${dim("for the commands, or")} /help overlay ${dim("for one topic.")}`);
  out.push("");
  return out;
}
