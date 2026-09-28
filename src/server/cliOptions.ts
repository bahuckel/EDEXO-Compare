/**
 * Command-line options for the server (host, port, journal folder). Split out of edexoBootstrap.ts (code review D, 2026-09-28).
 */
export function parseHost(argv: string[]): string {
  const i = argv.indexOf("--host");
  if (i >= 0 && argv[i + 1]) return argv[i + 1]!;
  if (argv.includes("--lan")) return "0.0.0.0";
  if (argv.includes("--local")) return "127.0.0.1";
  return "0.0.0.0";
}

export function parsePort(argv: string[]): number {
  const i = argv.indexOf("--port");
  if (i >= 0 && argv[i + 1]) return Number(argv[i + 1]) || 7111;
  return 7111;
}

export type CliOptions = {
  bindHost: string;
  port: number;
  shouldOpenMainUI: boolean;
  quietConsole: boolean;
  useShellLauncher: boolean;
};

export function parseCli(argv: string[]): CliOptions {
  return {
    bindHost: parseHost(argv),
    port: parsePort(argv),
    shouldOpenMainUI: argv.includes("--open"),
    quietConsole: process.env.EDEXO_ELECTRON === "1" || argv.includes("--quiet") || argv.includes("--gui"),
    useShellLauncher: process.env.EDEXO_USE_SHELL_LAUNCHER === "1" || argv.includes("--shell-launcher"),
  };
}
