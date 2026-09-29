/**
 * The client side of "Notify me" (shared/notices.ts): which bodies on screen hold a record, the gold
 * medal that marks them, and the opt-in chime when a new record lands.
 */
import { useEffect, useRef } from "react";
import type { AppSnapshot } from "@shared/types";
import { recordText, type RecordMarkDTO } from "@shared/notices";

/** Records broken by bodies of the system on screen, by body id. */
export function recordMarksByBodyId(snap: Pick<AppSnapshot, "notices">): Map<number, RecordMarkDTO[]> {
  const out = new Map<number, RecordMarkDTO[]>();
  for (const m of snap.notices?.recordMarks ?? []) {
    const list = out.get(m.bodyId);
    if (list) list.push(m);
    else out.set(m.bodyId, [m]);
  }
  return out;
}

/** One line per record, for a tooltip. */
export function recordMarksTitle(marks: readonly RecordMarkDTO[]): string {
  return marks.map((m) => `Record: ${recordText(m)}`).join("\n");
}

export const RECORD_GOLD = "#f5b83d";

/** A small gold medal: ribbon and disc. */
export function RecordMedal({ marks, className }: { marks: readonly RecordMarkDTO[]; className?: string }) {
  if (!marks.length) return null;
  return (
    <svg
      className={`record-medal${className ? ` ${className}` : ""}`}
      viewBox="0 0 12 16"
      role="img"
      aria-label={marks.length > 1 ? `${marks.length} personal records` : "Personal record"}
    >
      <title>{recordMarksTitle(marks)}</title>
      <path d="M2.5 0.8 L5.2 6.4 L6.8 6.4 L4.2 0.8 Z" fill="#c2412d" />
      <path d="M9.5 0.8 L6.8 6.4 L5.2 6.4 L7.8 0.8 Z" fill="#e05a3f" />
      <circle cx="6" cy="10.4" r="4.4" fill={RECORD_GOLD} stroke="#8a5a12" strokeWidth="0.8" />
      <circle cx="6" cy="10.4" r="2.6" fill="none" stroke="#fff3c4" strokeWidth="0.7" strokeOpacity="0.8" />
    </svg>
  );
}

/*
  The record chime: three rising bell tones. Different from the HUD's sample cues (a single 880 Hz
  beep, and 660 → 990) so the ear can tell them apart. Only on this PC's own window — a phone on the
  LAN following along should not ring too.
*/
let ctx: AudioContext | null = null;
function playRecordChime(): void {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === "suspended") void ctx.resume();
    const t0 = ctx.currentTime + 0.02;
    [1047, 1319, 1568].forEach((f, i) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      const t = t0 + i * 0.13;
      o.type = "triangle";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      o.connect(g);
      g.connect(ctx!.destination);
      o.start(t);
      o.stop(t + 0.75);
    });
  } catch {
    /* no audio device: the chime is optional */
  }
}

function isThisPc(): boolean {
  const h = window.location.hostname;
  return h === "127.0.0.1" || h === "localhost" || h === "[::1]" || h === "::1";
}

/** Rings once per record notice that appears while the app is open, when the chime is on. */
export function useRecordChime(snap: Pick<AppSnapshot, "notices" | "journalBoot">): void {
  const known = useRef<Set<string> | null>(null);
  const items = snap.notices?.items;
  const on = snap.notices?.chime === true;
  useEffect(() => {
    if (!items || snap.journalBoot) return;
    const ids = items.filter((n) => n.kind === "record").map((n) => n.id);
    // The first list seen is what was already there, not news.
    if (known.current == null) {
      known.current = new Set(ids);
      return;
    }
    const fresh = ids.filter((id) => !known.current!.has(id));
    for (const id of fresh) known.current.add(id);
    if (fresh.length && on && isThisPc()) playRecordChime();
  }, [items, on, snap.journalBoot]);
}
