/**
 * Branded panel snapshots (owner, 2026-09-26): a camera on Exo-signals, Candidate species and the
 * system map turns that panel into a PNG with the ED Exo Compare stamp under it — for Discord, for
 * a codex log, for a friend.
 *
 * The stamp is not optional. What goes beside it is: commander name, system name and a timestamp,
 * each off until switched on in Options (`AppSnapshot.photoStamp`). The image is the panel as the
 * commander sees it, drawn from the DOM by `html-to-image` — not a screen grab, so it works the same
 * in the app window and in a browser, and a panel scrolled half off screen comes out whole.
 *
 * Click copies it to the clipboard; Shift+click saves a file. The clipboard needs a secure context,
 * which the local app and `127.0.0.1` are and a phone on the LAN is not — there it saves instead.
 */
import { toSvg } from "html-to-image";
import type { PhotoStampPrefs } from "@shared/types";

export interface SnapshotStamp {
  prefs: PhotoStampPrefs;
  commanderName: string | null;
  systemName: string | null;
}

/**
 * What the next snapshot stamps. App writes it on every snapshot it receives, so the buttons need
 * no props threaded through every panel that might carry one.
 */
let current: SnapshotStamp = {
  prefs: { commander: false, system: false, timestamp: false },
  commanderName: null,
  systemName: null,
};

export function setSnapshotStamp(s: SnapshotStamp): void {
  current = s;
}

export function snapshotStamp(): SnapshotStamp {
  return current;
}

/** Elements with this class are left out of the image (the camera itself, open popovers). */
export const SNAPSHOT_SKIP_CLASS = "snapshot-skip";

const ICON_URL = "/edexo-icon-124.webp";

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** `2026-09-26 21:58 UTC` — one clock for every commander who reads the picture. */
export function stampTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

/** The optional lines, in order, for what is switched on and known. */
export function stampLines(s: SnapshotStamp, now: Date): string[] {
  const lines: string[] = [];
  if (s.prefs.commander && s.commanderName?.trim()) lines.push(`CMDR ${s.commanderName.trim()}`);
  if (s.prefs.system && s.systemName?.trim()) lines.push(s.systemName.trim());
  if (s.prefs.timestamp) lines.push(stampTime(now));
  return lines;
}

/** A file name that sorts and says what it is: `EDEXO-Tegnae-ZK-Z-c28-3-candidates-20260926-2158.png`. */
export function snapshotFileName(what: string, systemName: string | null, now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const t = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}`;
  const clean = (x: string) =>
    x
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  return ["EDEXO", systemName ? clean(systemName) : null, clean(what), t].filter(Boolean).join("-") + ".png";
}

/** Draw `el` and the stamp under it. */
export async function renderBrandedSnapshot(el: HTMLElement, stamp: SnapshotStamp = current): Promise<Blob> {
  const now = new Date();
  const bg = getComputedStyle(document.body).backgroundColor || cssVar("--ink", "#07060a");
  const scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  /*
   * The panel as SVG, then onto a canvas here. `toCanvas` would do both, but it waits on
   * `requestAnimationFrame` after the image loads, and rAF never fires in a window that is not
   * painting (behind others, minimised, a background tab): the snapshot would hang with no error.
   * The load event does not need a paint.
   */
  const svg = await toSvg(el, {
    backgroundColor: bg,
    skipFonts: true,
    // The copy is drawn as it finally looks: a dialog caught mid fade-in would otherwise come out blank.
    style: { opacity: "1", transform: "none", animation: "none" },
    // Leave the camera and anything marked out of the picture.
    filter: (node) => !(node instanceof HTMLElement && node.classList.contains(SNAPSHOT_SKIP_CLASS)),
  });
  const svgImg = await loadImage(svg);
  if (!svgImg || !svgImg.naturalWidth) throw new Error("Could not draw the panel.");
  const panel = document.createElement("canvas");
  panel.width = Math.round(svgImg.naturalWidth * scale);
  panel.height = Math.round(svgImg.naturalHeight * scale);
  panel.getContext("2d")!.drawImage(svgImg, 0, 0, panel.width, panel.height);

  const accent = cssVar("--hud", "#ff8a1f");
  const text = cssVar("--hud-text", "#ffe6cf");
  const dim = cssVar("--hud-dim", "rgba(255, 138, 31, 0.55)");
  const font = cssVar("--hud-font", "Bahnschrift, 'Segoe UI', system-ui, sans-serif");
  const lines = stampLines(stamp, now);

  const pad = 14 * scale;
  const iconSize = 36 * scale;
  const footerH = Math.max(iconSize, lines.length * 17 * scale) + pad * 2;
  const out = document.createElement("canvas");
  out.width = panel.width;
  out.height = panel.height + footerH;
  const g = out.getContext("2d")!;
  g.fillStyle = bg;
  g.fillRect(0, 0, out.width, out.height);
  g.drawImage(panel, 0, 0);

  // A thin rule in the HUD colour between the panel and the stamp.
  const y0 = panel.height;
  g.fillStyle = dim;
  g.fillRect(0, y0, out.width, Math.max(1, scale));

  const icon = await loadImage(ICON_URL);
  let x = pad;
  const midY = y0 + footerH / 2;
  if (icon) {
    g.drawImage(icon, x, midY - iconSize / 2, iconSize, iconSize);
    x += iconSize + 10 * scale;
  }
  g.textBaseline = "middle";
  g.fillStyle = accent;
  g.font = `700 ${15 * scale}px ${font}`;
  g.fillText("ED EXO COMPARE", x, midY - 8 * scale);
  g.fillStyle = dim;
  g.font = `400 ${11 * scale}px ${font}`;
  g.fillText("by CMDR FALrenica · bahuckel.com/projects/edexo-compare", x, midY + 9 * scale);

  // The optional lines, right-aligned, one under the other.
  g.textAlign = "right";
  g.fillStyle = text;
  g.font = `500 ${12.5 * scale}px ${font}`;
  const lineH = 17 * scale;
  const top = midY - ((lines.length - 1) * lineH) / 2;
  lines.forEach((l, i) => g.fillText(l, out.width - pad, top + i * lineH));

  return await new Promise<Blob>((resolve, reject) =>
    out.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode the image."))), "image/png"),
  );
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Copy when the page may, save otherwise. Says which it did. */
export async function copyOrSave(
  blob: Blob,
  fileName: string,
  preferSave: boolean,
): Promise<"copied" | "saved"> {
  if (!preferSave && window.isSecureContext && navigator.clipboard && typeof ClipboardItem !== "undefined") {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      return "copied";
    } catch {
      /* fall through to a file */
    }
  }
  downloadBlob(blob, fileName);
  return "saved";
}
