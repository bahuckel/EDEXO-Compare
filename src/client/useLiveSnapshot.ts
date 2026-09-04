import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AppSnapshot } from "@shared/types";
import { perfSnapshotCommitted, perfSnapshotReceived } from "./perf";
import { reuseUnchanged } from "./snapshotMerge";

function websocketUrl(): string {
  const p = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${p}//${window.location.host}/ws`;
}

/** HTTP backup while WebSocket is primary — recovers from half-open / silent WS drops without waiting for onclose. */
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
    const applyPayload = (payload: AppSnapshot) => {
      setSnapshot((prev) => (prev ? reuseUnchanged(prev, payload) : payload));
      setLastStateAtValue(Date.now());
    };

    void fetch("/api/state")
      .then((r) => r.text())
      .then((t) => {
        if (cancelled) return;
        perfSnapshotReceived(t.length);
        applyPayload(JSON.parse(t) as AppSnapshot);
      })
      .catch(() => {
        if (!cancelled) setConnected(false);
      });

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
            applyPayload(msg.payload as AppSnapshot);
          }
        } catch {
          /* ignore */
        }
      };
    };
    connect();

    const httpBackup = window.setInterval(() => {
      if (cancelled) return;
      void fetch("/api/state", { cache: "no-store" })
        .then((r) => r.text())
        .then((t) => {
          if (cancelled) return;
          perfSnapshotReceived(t.length);
          applyPayload(JSON.parse(t) as AppSnapshot);
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
