import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AppSnapshot } from "@shared/types";
import { perfSnapshotCommitted, perfSnapshotReceived } from "./perf";
import { reuseUnchanged } from "./snapshotMerge";

function websocketUrl(): string {
  const p = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${p}//${window.location.host}/ws`;
}

/**
 * The backup check while the WebSocket is primary — recovers from half-open / silent drops without
 * waiting for onclose. Every 10 s it asks for the revision of the last push (a few bytes) and fetches
 * the full snapshot only when a push was missed or the socket is down (UI review P2: it used to fetch
 * the whole snapshot every 10 s regardless).
 */
const HTTP_STATE_BACKUP_MS = 10_000;

/**
 * "Last snapshot at" as a tiny external store rather than a prop.
 *
 * It changes on every push, including pushes that change nothing else. Threading it through
 * <HeaderBar> as a prop would invalidate the whole header on each one and defeat memoization, so
 * the only component that renders it subscribes directly.
 */
let lastStateAtValue: number | null = null;
const lastStateAtListeners = new Set<() => void>();

function setLastStateAtValue(v: number | null): void {
  lastStateAtValue = v;
  for (const l of lastStateAtListeners) l();
}

export function useLastStateAt(): number | null {
  const subscribe = useCallback((onChange: () => void) => {
    lastStateAtListeners.add(onChange);
    return () => lastStateAtListeners.delete(onChange);
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => lastStateAtValue,
    () => lastStateAtValue,
  );
}

export function useLiveSnapshot(): {
  snapshot: AppSnapshot | null;
  connected: boolean;
} {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;

    const clearReconnect = () => {
      if (reconnectRef.current != null) {
        clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
    };

    /**
     * Keep the previous object identity for every branch that did not change, so downstream
     * `useMemo`/`React.memo` only invalidate for data that actually moved.
     */
    let lastRev: number | null = null;
    /*
      A push leaves out the big fields that did not change since the one before and names them in
      `unchanged` (UI review P1); they are taken from the snapshot already held. The socket's first
      message is always complete, so there is one to take them from — if there somehow is not, the
      full snapshot is fetched.
    */
    /*
      A push may also carry `bodiesDelta` instead of `bodies` (P1b): every body key in order and only
      the bodies that changed; the others come from the held copy by key. The merge is done here, on
      the snapshot this effect last applied, not inside a state updater (React may run those later).
    */
    let held: AppSnapshot | null = null;
    const applyPayload = (
      payload: AppSnapshot,
      unchanged?: string[],
      bodiesDelta?: { keys: string[]; changed: AppSnapshot["bodies"] },
    ) => {
      const p = payload as unknown as Record<string, unknown>;
      if (unchanged?.length || bodiesDelta) {
        if (!held) {
          fetchFull();
          return;
        }
        const old = held as unknown as Record<string, unknown>;
        for (const k of unchanged ?? []) p[k] = old[k];
        if (bodiesDelta) {
          const byKey = new Map((held.bodies ?? []).map((b) => [b.state.key, b]));
          for (const b of bodiesDelta.changed) byKey.set(b.state.key, b);
          const bodies = bodiesDelta.keys.map((k) => byKey.get(k));
          if (bodies.some((b) => b === undefined)) {
            fetchFull();
            return;
          }
          payload.bodies = bodies as AppSnapshot["bodies"];
        }
      }
      const next: AppSnapshot = held ? reuseUnchanged(held, payload) : payload;
      held = next;
      setSnapshot(next);
      setLastStateAtValue(Date.now());
    };

    const fetchFull = () =>
      void fetch("/api/state", { cache: "no-store" })
        .then((r) => {
          const rev = Number(r.headers.get("X-Edexo-Rev"));
          if (Number.isFinite(rev)) lastRev = rev;
          return r.text();
        })
        .then((t) => {
          if (cancelled) return;
          perfSnapshotReceived(t.length);
          applyPayload(JSON.parse(t) as AppSnapshot);
        })
        .catch(() => {
          if (!cancelled) setConnected(false);
        });

    fetchFull();

    const connect = () => {
      if (cancelled) return;
      clearReconnect();
      ws = new WebSocket(websocketUrl());
      ws.onopen = () => setConnected(true);
      ws.onerror = () => setConnected(false);
      ws.onclose = () => {
        setConnected(false);
        if (!cancelled) {
          reconnectRef.current = setTimeout(connect, 1100);
        }
      };
      ws.onmessage = (ev) => {
        try {
          const raw = String(ev.data);
          const msg = JSON.parse(raw);
          if (msg.type === "state") {
            perfSnapshotReceived(raw.length);
            if (typeof msg.rev === "number") lastRev = msg.rev;
            applyPayload(
              msg.payload as AppSnapshot,
              Array.isArray(msg.unchanged) ? (msg.unchanged as string[]) : undefined,
              msg.bodiesDelta && Array.isArray(msg.bodiesDelta.keys) ? msg.bodiesDelta : undefined,
            );
          }
        } catch {
          /* ignore */
        }
      };
    };
    connect();

    const httpBackup = window.setInterval(() => {
      if (cancelled) return;
      if (!ws || ws.readyState !== WebSocket.OPEN || lastRev === null) {
        fetchFull();
        return;
      }
      void fetch("/api/state/rev", { cache: "no-store" })
        .then((r) => r.json() as Promise<{ rev?: number }>)
        .then((j) => {
          if (!cancelled && typeof j.rev === "number" && j.rev !== lastRev) fetchFull();
        })
        .catch(() => {
          if (!cancelled) setConnected(false);
        });
    }, HTTP_STATE_BACKUP_MS);

    return () => {
      cancelled = true;
      clearReconnect();
      clearInterval(httpBackup);
      ws?.close();
    };
  }, []);

  /** Runs after each snapshot commit; no-op unless client perf is enabled. */
  useEffect(() => {
    perfSnapshotCommitted();
  }, [snapshot]);

  return { snapshot, connected };
}
