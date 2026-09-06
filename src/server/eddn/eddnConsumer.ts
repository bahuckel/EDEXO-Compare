/**
 * The EDDN consumer — INCLUDE-BODY-IDS Phase 4.
 *
 * A long-running subscriber that folds body observations into the register. It never finishes, so
 * the two properties that matter are that it can be **stopped and restarted without changing a
 * count**, and that it **cannot grow without bound**.
 *
 * Idempotence comes free from the identity key: every observation is addressed by
 * `(SystemAddress, BodyID)`, which the game assigns, so replaying the same batch twice folds into
 * the same row. There is no sequence number to track and nothing to deduplicate.
 *
 * Boundedness comes from the filter in `eddnMessage.ts`: only evidence of biology creates a row.
 *
 * **This is a consumer, not a publisher.** Nothing leaves the machine — the socket is opened
 * outbound, subscribed, and read. If EDEXO ever uploads to EDDN, that is a §50-shaped change with a
 * privacy-policy line naming what leaves, an explicit opt-in, and off by default. Uploading must not
 * arrive as a side effect of consuming.
 */
import { decodeEddnFrame, extractBodyObservation } from "./eddnMessage.js";
import { ZmtpSubscriber } from "./zmtpSubscriber.js";
import type { FeederStore } from "../../feeder/feederDb.js";

export const EDDN_HOST = "eddn.edcd.io";
export const EDDN_PORT = 9500;

export interface ConsumerCounters {
  frames: number;
  decoded: number;
  relevant: number;
  created: number;
  updated: number;
  ignored: number;
  startedAt: number;
}

export interface ConsumerOptions {
  store: FeederStore;
  host?: string;
  port?: number;
  /**
   * Write the store to disk every N changes. sql.js keeps the database in memory and `persist()`
   * rewrites the whole file, so this trades a little I/O against how much a crash costs. At the
   * observed rate — a few relevant messages a second — 200 is a minute or two of work.
   */
  persistEvery?: number;
  onTick?: (c: ConsumerCounters) => void;
  /** How often to report progress. A silent always-on process is one nobody trusts. */
  tickMs?: number;
}

export class EddnConsumer {
  private readonly counters: ConsumerCounters = {
    frames: 0,
    decoded: 0,
    relevant: 0,
    created: 0,
    updated: 0,
    ignored: 0,
    startedAt: Date.now(),
  };
  private sub: ZmtpSubscriber | null = null;
  private ticker: NodeJS.Timeout | null = null;
  private sincePersist = 0;

  constructor(private readonly opts: ConsumerOptions) {}

  get stats(): Readonly<ConsumerCounters> {
    return this.counters;
  }

  /** Fold one raw frame. Exported behaviour, so the pipeline is testable without a socket. */
  handleFrame(raw: Buffer): void {
    this.counters.frames += 1;
    const env = decodeEddnFrame(raw);
    if (!env) return;
    this.counters.decoded += 1;

    const obs = extractBodyObservation(env);
    if (!obs) return;
    this.counters.relevant += 1;

    const result = this.opts.store.upsertEddnBody(obs);
    this.counters[result] += 1;

    if (result !== "ignored") {
      this.sincePersist += 1;
      if (this.sincePersist >= (this.opts.persistEvery ?? 200)) {
        this.opts.store.persist();
        this.sincePersist = 0;
      }
    }
  }

  start(): void {
    this.sub = new ZmtpSubscriber({
      host: this.opts.host ?? EDDN_HOST,
      port: this.opts.port ?? EDDN_PORT,
      onMessage: (body) => this.handleFrame(body),
      onError: (err) => console.error(`eddn: ${err.message}`),
      onStateChange: (s) => console.log(`eddn: ${s}`),
    });
    this.sub.start();
    if (this.opts.onTick) {
      this.ticker = setInterval(() => this.opts.onTick?.(this.counters), this.opts.tickMs ?? 30_000);
      this.ticker.unref?.();
    }
  }

  /** Stop, and flush — an always-on process that loses its last minute on exit is not restartable. */
  stop(): void {
    this.sub?.stop();
    this.sub = null;
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    if (this.sincePersist > 0) {
      this.opts.store.persist();
      this.sincePersist = 0;
    }
  }
}

export function formatCounters(c: ConsumerCounters): string {
  const secs = Math.max(1, Math.round((Date.now() - c.startedAt) / 1000));
  const rate = (c.frames / secs).toFixed(1);
  return (
    `${secs}s · ${c.frames.toLocaleString()} frames (${rate}/s) · ` +
    `${c.relevant.toLocaleString()} about biology · ` +
    `${c.created.toLocaleString()} new bodies, ${c.updated.toLocaleString()} updated, ${c.ignored.toLocaleString()} ignored`
  );
}
