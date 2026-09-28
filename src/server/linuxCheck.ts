/**
 * The Linux start-up check (owner, 2026-09-28; docs/linux-plan-28092026.md Phase C): what is missing
 * for the HUD and the launcher on this machine, and the exact command to install it **on this
 * distro** — "dependency install commands are different between distros, so can we have a check for
 * that on start to provide the user with the correct commands".
 *
 * Pure: the distro file, the environment and every probe of the system come in as arguments
 * (linuxProbes.ts supplies the real ones), so each distro and each failure is a test fixture.
 *
 * Only failures are returned, and only those that matter to this build: the HUD rows (XWayland, a
 * compositor, the tray, gamescope) only when the Electron app is running — the browser build has no
 * HUD windows to worry about.
 */

/** How packages are installed. `fedora-atomic` = image-based Fedora (Silverblue, Kinoite, Bazzite). */
export type DistroFamily =
  "debian" | "fedora" | "fedora-atomic" | "suse" | "arch" | "steamos" | "nixos" | "unknown";

export interface Distro {
  /** os-release `ID` ("ubuntu", "bazzite", "opensuse-tumbleweed"). */
  id: string;
  /** os-release `PRETTY_NAME`, or `NAME`, for the card. */
  name: string;
  /** os-release `VERSION_ID` ("24.04"), when there is one. */
  version: string | null;
  /**
   * The release it is built on, by codename: Ubuntu's (`UBUNTU_CODENAME`, which Mint and Pop!_OS also
   * carry) or Debian's (`VERSION_CODENAME` / `DEBIAN_CODENAME`). Package names change between
   * releases, and a derivative's own version number says nothing about which base it is.
   */
  ubuntuCodename: string | null;
  debianCodename: string | null;
  family: DistroFamily;
}

/** `KEY=value` / `KEY="value"` lines of /etc/os-release. */
export function parseOsRelease(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    out[m[1]!] = m[2]!.replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

/** The family from `ID` and `ID_LIKE`, and `/run/ostree-booted` for image-based Fedora. */
export function detectDistro(osRelease: Record<string, string>, ostreeBooted: boolean): Distro {
  const id = (osRelease.ID ?? "").toLowerCase();
  const like = (osRelease.ID_LIKE ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const ids = [id, ...like];
  const has = (...xs: string[]) => xs.some((x) => ids.includes(x));
  let family: DistroFamily = "unknown";
  if (id === "steamos") family = "steamos";
  else if (id === "nixos") family = "nixos";
  else if (has("fedora", "rhel", "centos")) family = ostreeBooted ? "fedora-atomic" : "fedora";
  else if (has("debian", "ubuntu")) family = "debian";
  else if (ids.some((x) => x === "suse" || x.startsWith("opensuse") || x === "sles")) family = "suse";
  else if (has("arch")) family = "arch";
  const lower = (v: string | undefined) => (v ? v.toLowerCase() : null);
  return {
    id: id || "linux",
    name: osRelease.PRETTY_NAME || osRelease.NAME || "Linux",
    version: osRelease.VERSION_ID || null,
    ubuntuCodename:
      lower(osRelease.UBUNTU_CODENAME) ?? (id === "ubuntu" ? lower(osRelease.VERSION_CODENAME) : null),
    debianCodename:
      lower(osRelease.DEBIAN_CODENAME) ?? (id === "debian" ? lower(osRelease.VERSION_CODENAME) : null),
    family,
  };
}

/** What a package provides, as the checks ask for it. */
export type Capability = "fuse2" | "xwayland" | "compositor" | "trayExtension" | "xdgOpen";

/**
 * libfuse.so.2 on the Debian side: renamed `libfuse2t64` in the 64-bit time_t transition, from
 * Ubuntu 24.04 "noble" and Debian 13 "trixie" (verified in packages.ubuntu.com / packages.debian.org,
 * 2026-09-28: an exact `libfuse2` finds nothing there). Older bases keep `libfuse2`.
 */
const UBUNTU_BEFORE_T64 = ["xenial", "bionic", "focal", "jammy"];
const DEBIAN_BEFORE_T64 = ["stretch", "buster", "bullseye", "bookworm"];
function debianFuse2(d: Distro): string {
  if (d.ubuntuCodename) return UBUNTU_BEFORE_T64.includes(d.ubuntuCodename) ? "libfuse2" : "libfuse2t64";
  if (d.debianCodename) return DEBIAN_BEFORE_T64.includes(d.debianCodename) ? "libfuse2" : "libfuse2t64";
  if (d.id === "ubuntu" && d.version) return versionAtLeast(d.version, 24.04) ? "libfuse2t64" : "libfuse2";
  if (d.id === "debian") return versionAtLeast(d.version, 13) || !d.version ? "libfuse2t64" : "libfuse2";
  return "libfuse2t64";
}

/**
 * Package names per family, each checked in the distro's own package index on 2026-09-28 (Debian
 * trixie, Ubuntu jammy + noble, Fedora 43-45, openSUSE Tumbleweed, Arch). A name that differs by
 * release is a function; a family with no official package is left out, and the card says where to
 * get it instead.
 */
const PACKAGES: Record<Capability, Partial<Record<DistroFamily, string | ((d: Distro) => string)>>> = {
  fuse2: {
    debian: debianFuse2,
    fedora: "fuse-libs",
    "fedora-atomic": "fuse-libs",
    suse: "libfuse2",
    arch: "fuse2",
    nixos: "fuse",
  },
  xwayland: {
    debian: "xwayland",
    fedora: "xorg-x11-server-Xwayland",
    "fedora-atomic": "xorg-x11-server-Xwayland",
    suse: "xwayland",
    arch: "xorg-xwayland",
    nixos: "xwayland",
  },
  compositor: {
    debian: "picom",
    fedora: "picom",
    "fedora-atomic": "picom",
    suse: "picom",
    arch: "picom",
    nixos: "picom",
  },
  trayExtension: {
    debian: "gnome-shell-extension-appindicator",
    fedora: "gnome-shell-extension-appindicator",
    "fedora-atomic": "gnome-shell-extension-appindicator",
    // openSUSE: not in the official repositories (only home: projects) — extensions.gnome.org instead.
    arch: "gnome-shell-extension-appindicator",
    nixos: "gnomeExtensions.appindicator",
  },
  xdgOpen: {
    debian: "xdg-utils",
    fedora: "xdg-utils",
    "fedora-atomic": "xdg-utils",
    suse: "xdg-utils",
    arch: "xdg-utils",
    nixos: "xdg-utils",
  },
};

function versionAtLeast(v: string | null, min: number): boolean {
  const n = Number.parseFloat(v ?? "");
  return Number.isFinite(n) && n >= min;
}

/** The package that provides `cap` on this distro, or null when the family is not known. */
export function packageFor(cap: Capability, d: Distro): string | null {
  const p = PACKAGES[cap][d.family];
  if (!p) return null;
  return typeof p === "function" ? p(d) : p;
}

/**
 * The command that installs `packages` here, or null when there is none to offer: SteamOS (the
 * system is read-only) and a distro this does not know (the names are shown on their own).
 */
export function installCommand(d: Distro, packages: string[]): string | null {
  if (!packages.length) return null;
  const list = packages.join(" ");
  switch (d.family) {
    case "debian":
      return `sudo apt install ${list}`;
    case "fedora":
      return `sudo dnf install ${list}`;
    case "fedora-atomic":
      return `rpm-ostree install ${list} && systemctl reboot`;
    case "suse":
      return `sudo zypper install ${list}`;
    case "arch":
      return `sudo pacman -S --needed ${list}`;
    case "nixos":
      return `# add to environment.systemPackages in configuration.nix, then nixos-rebuild switch: ${packages
        .map((p) => `pkgs.${p}`)
        .join(" ")}`;
    default:
      return null;
  }
}

/** What the system looks like; the real probes are in linuxProbes.ts. */
export interface LinuxProbes {
  /** An executable of this name on PATH. */
  hasCommand(name: string): boolean;
  /** A process with one of these names running. */
  processRunning(names: string[]): boolean;
  /** A tray host (StatusNotifierWatcher) on the session bus; null when that cannot be asked. */
  trayHost(): boolean | null;
}

export interface LinuxCheckInput {
  osRelease: Record<string, string>;
  ostreeBooted: boolean;
  env: Record<string, string | undefined>;
  /** The Electron app (launcher + HUD) rather than the browser build. */
  electron: boolean;
  probes: LinuxProbes;
}

export interface LinuxCheckItem {
  id: "gamescope" | "xwayland" | "compositor" | "tray" | "xdgOpen";
  /** `blocker`: the feature cannot work; `warning`: it works worse; `info`: nothing to install. */
  severity: "blocker" | "warning" | "info";
  title: string;
  detail: string;
  packages: string[];
  /** The install command for this distro; null when there is none to give. */
  command: string | null;
  /** A second step after installing (enable the extension, start the compositor). */
  then?: string;
}

export interface LinuxCheckResult {
  distro: Distro;
  /** `wayland`, `x11`, or `tty`/unknown. */
  session: string;
  desktop: string;
  items: LinuxCheckItem[];
}

/** Window managers that do not composite on their own: a transparent HUD needs picom beside them. */
const BARE_WMS = [
  "i3",
  "bspwm",
  "awesome",
  "openbox",
  "xmonad",
  "dwm",
  "qtile",
  "herbstluftwm",
  "fluxbox",
  "icewm",
  "spectrwm",
  "leftwm",
];

export function runLinuxCheck(input: LinuxCheckInput): LinuxCheckResult {
  const { env, probes } = input;
  const distro = detectDistro(input.osRelease, input.ostreeBooted);
  const desktop = (env.XDG_CURRENT_DESKTOP ?? "").toLowerCase();
  const wayland = (env.XDG_SESSION_TYPE ?? "").toLowerCase() === "wayland" || !!env.WAYLAND_DISPLAY;
  const session = wayland ? "wayland" : env.DISPLAY ? "x11" : (env.XDG_SESSION_TYPE ?? "unknown");
  const items: LinuxCheckItem[] = [];
  const item = (i: Omit<LinuxCheckItem, "command" | "packages">, caps: Capability[] = []) => {
    const packages = caps.map((c) => packageFor(c, distro)).filter((p): p is string => !!p);
    items.push({ ...i, packages, command: installCommand(distro, packages) });
  };

  const gamescope = desktop.split(":").includes("gamescope") || !!env.GAMESCOPE_WAYLAND_DISPLAY;
  if (gamescope) {
    item({
      id: "gamescope",
      severity: input.electron ? "blocker" : "info",
      title: "Running inside gamescope (Steam Deck Game Mode)",
      detail:
        "gamescope shows only the game, so no window can draw over it and the HUD will not appear. " +
        "Use the HUD page on a phone or a second screen (the launcher shows its address and a QR code)" +
        (distro.family === "steamos" ? ", or switch the Deck to Desktop Mode." : "."),
    });
  }

  if (input.electron && !gamescope) {
    if (wayland && !env.DISPLAY) {
      item(
        {
          id: "xwayland",
          severity: "blocker",
          title: "XWayland is not available",
          detail:
            "On Wayland the HUD windows run through XWayland — Wayland itself does not let an app place " +
            "its windows or keep them above the game. Without it the HUDs cannot be positioned or kept on top.",
        },
        ["xwayland"],
      );
    }
    const bare = !wayland && (desktop === "" || BARE_WMS.some((w) => desktop.split(":").includes(w)));
    if (bare && !probes.processRunning(["picom", "compton", "xcompmgr"])) {
      item(
        {
          id: "compositor",
          severity: "warning",
          title: "No compositor running",
          detail:
            "Without a compositor the HUD cannot be see-through: it draws as a solid box over the game.",
          then: "Start it with `picom -b` (and add that to your window manager's autostart).",
        },
        ["compositor"],
      );
    }
    if (desktop.split(":").includes("gnome") && probes.trayHost() === false) {
      item(
        {
          id: "tray",
          severity: "warning",
          title: "GNOME has no tray",
          detail:
            'GNOME shows no tray icons without the AppIndicator extension, so "Minimise to tray" is off ' +
            "until it is installed and enabled.",
          then: packageFor("trayExtension", distro)
            ? "Enable it with `gnome-extensions enable appindicatorsupport@rgcjonas.gmail.com` (log out and back in if it does not show)."
            : 'It is not in your distro\'s repositories: install "AppIndicator and KStatusNotifierItem Support" from https://extensions.gnome.org/extension/615/ , then log out and back in.',
        },
        ["trayExtension"],
      );
    }
  }

  if (!probes.hasCommand("xdg-open")) {
    item(
      {
        id: "xdgOpen",
        severity: "warning",
        title: "Cannot open your browser",
        detail: '`xdg-open` is missing, so links and "Open in browser" do nothing; copy the address instead.',
      },
      ["xdgOpen"],
    );
  }

  return { distro, session, desktop: env.XDG_CURRENT_DESKTOP ?? "", items };
}
