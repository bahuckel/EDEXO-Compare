/**
 * The console build's prompt.
 *
 * Thin on purpose: readline in, {@link dispatch} out, printing whatever comes back. Everything worth
 * testing lives in `commands.ts` and `dispatch.ts`, which need no terminal.
 *
 * It only starts on a real TTY. Piped output, a service wrapper, or Electron's own use of this
 * bundle must not get a prompt written into their stream — those keep exactly the behaviour they had
 * before there was a REPL at all.
 */
import { createInterface } from "node:readline";
import { bannerLines } from "./banner.js";
import { CliClient } from "./client.js";
import { dispatch } from "./dispatch.js";
import { allCommands } from "./commands.js";

export interface ReplOptions {
  /** The server this console started, e.g. `http://127.0.0.1:7111`. */
  ownBase: string;
  version?: string;
  /** Called on `/quit`. */
  onExit: () => void | Promise<void>;
}

/** Only what the check needs, so a test can pass two plain objects. */
interface MaybeTty {
  isTTY?: boolean;
}

/** True when a prompt makes sense: an interactive console, not a pipe and not Electron. */
export function shouldStartRepl(
  env: NodeJS.ProcessEnv = process.env,
  stdin: MaybeTty = process.stdin,
  stdout: MaybeTty = process.stdout,
): boolean {
  if (env.EDEXO_ELECTRON === "1") return false;
  if (env.EDEXO_NO_REPL === "1") return false;
  return Boolean(stdin.isTTY && stdout.isTTY);
}

/** Tab completion over the command names, which is most of what makes a REPL usable. */
function completer(line: string): [string[], string] {
  const names = allCommands().map((c) => `/${c.name}`);
  const bare = line.startsWith("/") ? line : `/${line}`;
  const hits = names.filter((n) => n.startsWith(bare));
  return [hits.length ? hits : names, line];
}

export function startRepl(opts: ReplOptions): void {
  const client = new CliClient({ base: opts.ownBase, own: true });
  const rl = createInterface({ input: process.stdin, output: process.stdout, completer, prompt: "edexo> " });

  for (const line of bannerLines({ version: opts.version, target: opts.ownBase })) console.log(line);

  let exiting = false;
  const ctx = {
    client,
    ownBase: opts.ownBase,
    requestExit: () => {
      exiting = true;
    },
  };

  rl.prompt();
  rl.on("line", (line) => {
    void (async () => {
      try {
        for (const out of await dispatch(line, ctx)) console.log(out);
      } catch (e) {
        // A handler throwing must not take the console with it.
        console.log(`Something went wrong running that: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (exiting) {
        rl.close();
        return;
      }
      rl.prompt();
    })();
  });

  rl.on("close", () => {
    void Promise.resolve(opts.onExit());
  });
}
