/**
 * The Linux start-up check (src/server/linuxCheck.ts): the right family and install command for each
 * distro, and each check failing only when it should. The os-release lines are the distros' own.
 */
import { describe, expect, it } from "vitest";
import {
  detectDistro,
  installCommand,
  packageFor,
  parseOsRelease,
  runLinuxCheck,
  type LinuxProbes,
} from "../src/server/linuxCheck.js";

const OS: Record<string, string> = {
  ubuntu2404:
    'NAME="Ubuntu"\nVERSION_ID="24.04"\nID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 24.04.1 LTS"\nUBUNTU_CODENAME=noble',
  ubuntu2204:
    'NAME="Ubuntu"\nVERSION_ID="22.04"\nID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 22.04.5 LTS"\nUBUNTU_CODENAME=jammy',
  mint: 'NAME="Linux Mint"\nVERSION_ID="22"\nID=linuxmint\nID_LIKE="ubuntu debian"\nPRETTY_NAME="Linux Mint 22"\nUBUNTU_CODENAME=noble',
  mint21:
    'NAME="Linux Mint"\nVERSION_ID="21.3"\nID=linuxmint\nID_LIKE="ubuntu debian"\nUBUNTU_CODENAME=jammy',
  pop: 'NAME="Pop!_OS"\nVERSION_ID="22.04"\nID=pop\nID_LIKE="ubuntu debian"\nPRETTY_NAME="Pop!_OS 22.04 LTS"\nUBUNTU_CODENAME=jammy',
  debian:
    'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nNAME="Debian GNU/Linux"\nVERSION_ID="12"\nVERSION_CODENAME=bookworm\nID=debian',
  trixie: 'PRETTY_NAME="Debian GNU/Linux 13 (trixie)"\nVERSION_ID="13"\nVERSION_CODENAME=trixie\nID=debian',
  fedora:
    'NAME="Fedora Linux"\nVERSION_ID=41\nID=fedora\nPRETTY_NAME="Fedora Linux 41 (Workstation Edition)"',
  silverblue:
    'NAME="Fedora Linux"\nVERSION_ID=41\nID=fedora\nVARIANT_ID=silverblue\nPRETTY_NAME="Fedora Linux 41 (Silverblue)"',
  bazzite: 'NAME="Bazzite"\nVERSION_ID="41"\nID=bazzite\nID_LIKE="fedora"\nPRETTY_NAME="Bazzite 41"',
  nobara:
    'NAME="Nobara Linux"\nVERSION_ID=41\nID=nobara\nID_LIKE="rhel centos fedora"\nPRETTY_NAME="Nobara Linux 41"',
  tumbleweed:
    'NAME="openSUSE Tumbleweed"\nID="opensuse-tumbleweed"\nID_LIKE="opensuse suse"\nVERSION_ID="20260920"\nPRETTY_NAME="openSUSE Tumbleweed"',
  leap: 'NAME="openSUSE Leap"\nVERSION="15.6"\nID="opensuse-leap"\nID_LIKE="suse opensuse"\nVERSION_ID="15.6"',
  arch: 'NAME="Arch Linux"\nPRETTY_NAME="Arch Linux"\nID=arch',
  cachyos: 'NAME="CachyOS Linux"\nPRETTY_NAME="CachyOS"\nID=cachyos\nID_LIKE=arch',
  manjaro: 'NAME="Manjaro Linux"\nID=manjaro\nID_LIKE=arch\nPRETTY_NAME="Manjaro Linux"',
  steamos: 'NAME="SteamOS"\nPRETTY_NAME="SteamOS"\nVERSION_ID=3.6\nID=steamos\nID_LIKE=arch',
  nixos: 'NAME=NixOS\nID=nixos\nVERSION_ID="24.11"\nPRETTY_NAME="NixOS 24.11 (Vicuna)"',
  void: 'NAME="Void"\nID="void"\nPRETTY_NAME="Void Linux"',
};
const ostree = new Set(["silverblue", "bazzite"]);
const distro = (k: string) => detectDistro(parseOsRelease(OS[k]!), ostree.has(k));

describe("which distro, which command", () => {
  it.each([
    ["ubuntu2404", "debian", "sudo apt install libfuse2t64"],
    ["ubuntu2204", "debian", "sudo apt install libfuse2"],
    ["mint", "debian", "sudo apt install libfuse2t64"],
    ["mint21", "debian", "sudo apt install libfuse2"],
    ["trixie", "debian", "sudo apt install libfuse2t64"],
    ["pop", "debian", "sudo apt install libfuse2"],
    ["debian", "debian", "sudo apt install libfuse2"],
    ["fedora", "fedora", "sudo dnf install fuse-libs"],
    ["nobara", "fedora", "sudo dnf install fuse-libs"],
    ["silverblue", "fedora-atomic", "rpm-ostree install fuse-libs && systemctl reboot"],
    ["bazzite", "fedora-atomic", "rpm-ostree install fuse-libs && systemctl reboot"],
    ["tumbleweed", "suse", "sudo zypper install libfuse2"],
    ["leap", "suse", "sudo zypper install libfuse2"],
    ["arch", "arch", "sudo pacman -S --needed fuse2"],
    ["cachyos", "arch", "sudo pacman -S --needed fuse2"],
    ["manjaro", "arch", "sudo pacman -S --needed fuse2"],
  ])("%s → %s: %s", (k, family, cmd) => {
    const d = distro(k);
    expect(d.family).toBe(family);
    expect(installCommand(d, [packageFor("fuse2", d)!])).toBe(cmd);
  });

  it("offers no command on SteamOS (read-only) or a distro it does not know, only the package name", () => {
    // SteamOS says ID_LIKE=arch, but pacman on its read-only root is not something to hand a player.
    expect(distro("steamos").family).toBe("steamos");
    expect(installCommand(distro("steamos"), ["fuse2"])).toBeNull();
    expect(distro("void").family).toBe("unknown");
    expect(installCommand(distro("void"), ["picom"])).toBeNull();
  });

  it("falls back to Ubuntu's version number when a file has no codename", () => {
    const d = detectDistro(parseOsRelease('ID=ubuntu\nVERSION_ID="22.04"'), false);
    expect(packageFor("fuse2", d)).toBe("libfuse2");
  });

  it("sends openSUSE to extensions.gnome.org for the tray extension, which it does not package", () => {
    const r = runLinuxCheck({
      osRelease: parseOsRelease(OS.tumbleweed!),
      ostreeBooted: false,
      env: { XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "w", DISPLAY: ":0", XDG_CURRENT_DESKTOP: "GNOME" },
      electron: true,
      probes: { hasCommand: () => true, processRunning: () => false, trayHost: () => false },
    });
    const tray = r.items.find((i) => i.id === "tray")!;
    expect(tray.command).toBeNull();
    expect(tray.then).toMatch(/extensions\.gnome\.org\/extension\/615/);
  });

  it("names the distro the way it names itself", () => {
    expect(distro("ubuntu2404")).toMatchObject({
      id: "ubuntu",
      name: "Ubuntu 24.04.1 LTS",
      version: "24.04",
    });
    expect(distro("bazzite").name).toBe("Bazzite 41");
  });

  it("points NixOS at its configuration instead of a command it does not have", () => {
    expect(installCommand(distro("nixos"), ["xwayland"])).toMatch(
      /environment\.systemPackages.*pkgs\.xwayland/,
    );
  });
});

const probes = (
  over: Partial<{ cmds: string[]; procs: string[]; tray: boolean | null }> = {},
): LinuxProbes => ({
  hasCommand: (n) => (over.cmds ?? ["xdg-open", "dbus-send"]).includes(n),
  processRunning: (names) => names.some((n) => (over.procs ?? []).includes(n)),
  trayHost: () => (over.tray === undefined ? true : over.tray),
});
const check = (k: string, env: Record<string, string>, p: LinuxProbes = probes(), electron = true) =>
  runLinuxCheck({ osRelease: parseOsRelease(OS[k]!), ostreeBooted: ostree.has(k), env, electron, probes: p });
const ids = (r: ReturnType<typeof check>) => r.items.map((i) => i.id);

describe("the checks", () => {
  it("says nothing on a normal KDE Wayland desktop with XWayland", () => {
    const r = check("cachyos", {
      XDG_SESSION_TYPE: "wayland",
      WAYLAND_DISPLAY: "wayland-0",
      DISPLAY: ":0",
      XDG_CURRENT_DESKTOP: "KDE",
    });
    expect(r.session).toBe("wayland");
    expect(r.items).toEqual([]);
  });

  it("blocks the HUD on Wayland without XWayland, with this distro's package", () => {
    const r = check("fedora", {
      XDG_SESSION_TYPE: "wayland",
      WAYLAND_DISPLAY: "wayland-0",
      XDG_CURRENT_DESKTOP: "GNOME",
    });
    const x = r.items.find((i) => i.id === "xwayland")!;
    expect(x.severity).toBe("blocker");
    expect(x.command).toBe("sudo dnf install xorg-x11-server-Xwayland");
  });

  it("asks for picom on a bare window manager with no compositor, and not when one runs", () => {
    const env = { XDG_SESSION_TYPE: "x11", DISPLAY: ":0", XDG_CURRENT_DESKTOP: "i3" };
    const r = check("arch", env);
    expect(r.items.find((i) => i.id === "compositor")).toMatchObject({
      command: "sudo pacman -S --needed picom",
      then: expect.stringContaining("picom -b"),
    });
    expect(ids(check("arch", env, probes({ procs: ["picom"] })))).not.toContain("compositor");
    // A full desktop composites on its own.
    expect(ids(check("arch", { ...env, XDG_CURRENT_DESKTOP: "XFCE" }))).not.toContain("compositor");
  });

  it("warns about the tray only on GNOME without a tray host, and not when it cannot tell", () => {
    const env = {
      XDG_SESSION_TYPE: "wayland",
      WAYLAND_DISPLAY: "w",
      DISPLAY: ":0",
      XDG_CURRENT_DESKTOP: "ubuntu:GNOME",
    };
    const tray = check("ubuntu2404", env, probes({ tray: false })).items.find((i) => i.id === "tray")!;
    expect(tray.command).toBe("sudo apt install gnome-shell-extension-appindicator");
    expect(tray.then).toMatch(/gnome-extensions enable appindicatorsupport@rgcjonas\.gmail\.com/);
    expect(ids(check("ubuntu2404", env, probes({ tray: null })))).not.toContain("tray");
    expect(ids(check("ubuntu2404", env, probes({ tray: true })))).not.toContain("tray");
  });

  it("explains gamescope instead of offering installs, and on SteamOS mentions Desktop Mode", () => {
    const r = check("steamos", {
      XDG_CURRENT_DESKTOP: "gamescope",
      GAMESCOPE_WAYLAND_DISPLAY: "gamescope-0",
    });
    expect(ids(r)).toEqual(["gamescope"]);
    expect(r.items[0]!.severity).toBe("blocker");
    expect(r.items[0]!.command).toBeNull();
    expect(r.items[0]!.detail).toMatch(/Desktop Mode/);
  });

  it("gives the browser build only what concerns it: no HUD rows, gamescope as information", () => {
    const env = { XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "w", XDG_CURRENT_DESKTOP: "gamescope" };
    const r = check("bazzite", env, probes({ cmds: [] }), false);
    expect(ids(r)).toEqual(["gamescope", "xdgOpen"]);
    expect(r.items[0]!.severity).toBe("info");
    expect(r.items[1]!.command).toBe("rpm-ostree install xdg-utils && systemctl reboot");
  });

  it("lists the package with no command on a distro it does not know", () => {
    const r = check("void", { XDG_SESSION_TYPE: "x11", DISPLAY: ":0" }, probes({ cmds: [] }));
    const x = r.items.find((i) => i.id === "xdgOpen")!;
    expect(x.packages).toEqual([]);
    expect(x.command).toBeNull();
  });
});
