import { useEffect, useRef, useState } from "react";

const POLL_MS = 15_000;
const STALE_MS = 60_000;

export type FdevServerStatusDisplay = {
  statusText: string;
  healthy: boolean;
  /** True when data comes from EDSM because Oerve has been unreachable for {@link STALE_MS}. */
  fromEdsm: boolean;
};

type OervePayload = { ok: true; healthy: boolean; statusText: string } | { ok: false };
type EdsmPayload = { ok: true; healthy: boolean; statusText: string } | { ok: false };

export function useFdevServerStatus(): FdevServerStatusDisplay {
  const [display, setDisplay] = useState<FdevServerStatusDisplay>({
    statusText: "Checking…",
    healthy: true,
    fromEdsm: false,
  });
  const lastOerveOkAt = useRef<number | null>(null);
  const mountedAt = useRef(Date.now());

  useEffect(() => {
    let cancelled = false;

    const pollOerve = async (): Promise<OervePayload> => {
      try {
        const r = await fetch("/api/elite-server-status/orerve");
        const j = (await r.json()) as OervePayload;
        return j && typeof j === "object" && "ok" in j ? j : { ok: false };
      } catch {
        return { ok: false };
      }
    };

    const pollEdsm = async (): Promise<EdsmPayload> => {
      try {
        const r = await fetch("/api/elite-server-status/edsm");
        const j = (await r.json()) as EdsmPayload;
        return j && typeof j === "object" && "ok" in j ? j : { ok: false };
      } catch {
        return { ok: false };
      }
    };

    const tick = async () => {
      const o = await pollOerve();
      if (cancelled) return;

      if (o.ok) {
        lastOerveOkAt.current = Date.now();
        setDisplay({
          statusText: o.statusText,
          healthy: o.healthy,
          fromEdsm: false,
        });
        return;
      }

      const last = lastOerveOkAt.current;
      const now = Date.now();
      const staleMs = last === null ? now - mountedAt.current : now - last;

      if (staleMs > STALE_MS) {
        const e = await pollEdsm();
        if (cancelled) return;
        if (e.ok) {
          setDisplay({
            statusText: e.statusText,
            healthy: e.healthy,
            fromEdsm: true,
          });
          return;
        }
        setDisplay((prev) => ({
          statusText: "Unavailable",
          healthy: false,
          fromEdsm: prev.fromEdsm,
        }));
        return;
      }

      /* Primary failed but still within grace: keep current UI. */
    };

    void tick();
    const id = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return display;
}
