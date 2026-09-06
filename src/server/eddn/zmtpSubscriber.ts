/**
 * A ZMTP 3.0 SUB client, in about two hundred lines of plain TypeScript.
 *
 * EDDN publishes over ZeroMQ PUB/SUB at `tcp://eddn.edcd.io:9500`. The obvious way to read that is
 * the `zeromq` npm package, and this project should not use it. Two runtime dependencies exist today
 * — `express` and `ws`, both pure JavaScript — and the app ships as an Electron portable exe *and*
 * as pkg-built CLI binaries. A native addon has to match Electron's ABI, be rebuilt per Electron
 * version, and survive pkg's bundler; `feederDb.ts` already chose WASM SQLite over a native driver
 * for exactly this reason, and `paths.ts` carries a warning about a third-party package that broke
 * the packaged app outright.
 *
 * Subscribing to a PUB socket needs a small, stable, documented subset of ZMTP, so this implements
 * that subset instead of importing a compiler toolchain.
 *
 * ## The wire protocol, as used here
 *
 * **Greeting**, 64 bytes each way, and the peer's is checked rather than assumed:
 * ```
 *   0xFF  8 bytes of padding  0x7F      signature, 10 bytes
 *   0x03  0x00                          version 3.0
 *   "NULL" padded to 20 bytes           security mechanism
 *   0x00                                as-server: we are the client
 *   31 bytes of zero                    filler
 * ```
 *
 * **Handshake**: both sides send a `READY` command naming their socket type. Ours is `SUB`.
 *
 * **Subscription**: ZMTP 3.0 carries subscriptions as an ordinary message whose first byte is 1 to
 * subscribe (0 to cancel), followed by the topic prefix. An empty prefix means everything, which is
 * what EDDN expects — it publishes one topic and filtering is the subscriber's job anyway.
 *
 * **Frames**: a flags byte (bit 0 = more frames follow, bit 1 = long form, bit 2 = command), then a
 * length (1 byte, or 8 bytes big-endian when long), then the body.
 *
 * ## What this deliberately does not do
 *
 * No CURVE, no PLAIN, no PUB/PUSH/REQ, no reconnect backoff cleverness beyond a fixed delay. It
 * subscribes to one publisher and yields message bodies. Anything more belongs in a real ZeroMQ
 * binding, and if this ever needs one, that is the moment to weigh the dependency again.
 */
import { connect, type Socket } from "node:net";

const SIGNATURE = Buffer.from([0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0x7f]);
const VERSION = Buffer.from([0x03, 0x00]);
const MECHANISM_NULL = Buffer.concat([Buffer.from("NULL", "ascii"), Buffer.alloc(16)]);
const AS_SERVER = Buffer.from([0x00]);
const FILLER = Buffer.alloc(31);

const GREETING = Buffer.concat([SIGNATURE, VERSION, MECHANISM_NULL, AS_SERVER, FILLER]);
const GREETING_LENGTH = 64;

/** A ZMTP command frame: `[flags=0x04][len][len-of-name][name][body]`. */
function commandFrame(name: string, body: Buffer): Buffer {
  const nameBuf = Buffer.from(name, "ascii");
  const payload = Buffer.concat([Buffer.from([nameBuf.length]), nameBuf, body]);
  if (payload.length > 255) {
    const header = Buffer.alloc(9);
    header.writeUInt8(0x06, 0); // command + long
    header.writeBigUInt64BE(BigInt(payload.length), 1);
    return Buffer.concat([header, payload]);
  }
  return Buffer.concat([Buffer.from([0x04, payload.length]), payload]);
}

/** `READY` carries metadata as length-prefixed key/value pairs. We send only the socket type. */
function readyFrame(socketType: string): Buffer {
  const key = Buffer.from("Socket-Type", "ascii");
  const value = Buffer.from(socketType, "ascii");
  const valueLen = Buffer.alloc(4);
  valueLen.writeUInt32BE(value.length, 0);
  return commandFrame("READY", Buffer.concat([Buffer.from([key.length]), key, valueLen, value]));
}

/** An ordinary (non-command) message frame, which is how ZMTP 3.0 sends a subscription. */
function messageFrame(body: Buffer): Buffer {
  if (body.length > 255) {
    const header = Buffer.alloc(9);
    header.writeUInt8(0x02, 0); // long form
    header.writeBigUInt64BE(BigInt(body.length), 1);
    return Buffer.concat([header, body]);
  }
  return Buffer.concat([Buffer.from([0x00, body.length]), body]);
}

/** Subscribe to a topic prefix. Empty means everything. */
export function subscribeFrame(topic = ""): Buffer {
  return messageFrame(Buffer.concat([Buffer.from([0x01]), Buffer.from(topic, "utf8")]));
}

export interface ParsedFrame {
  isCommand: boolean;
  more: boolean;
  body: Buffer;
  /** Bytes consumed from the input. */
  size: number;
}

/**
 * Read one frame from the head of a buffer, or null when it is not all there yet.
 *
 * Exported because a stream parser is exactly the kind of thing that is easy to get subtly wrong and
 * hard to debug live — it is tested directly against hand-built bytes.
 */
export function readFrame(buf: Buffer): ParsedFrame | null {
  if (buf.length < 2) return null;
  const flags = buf.readUInt8(0);
  const isLong = (flags & 0x02) !== 0;
  const more = (flags & 0x01) !== 0;
  const isCommand = (flags & 0x04) !== 0;

  if (isLong) {
    if (buf.length < 9) return null;
    const len = Number(buf.readBigUInt64BE(1));
    if (buf.length < 9 + len) return null;
    return { isCommand, more, body: buf.subarray(9, 9 + len), size: 9 + len };
  }
  const len = buf.readUInt8(1);
  if (buf.length < 2 + len) return null;
  return { isCommand, more, body: buf.subarray(2, 2 + len), size: 2 + len };
}

/** Whether a 64-byte greeting looks like a ZMTP 3.x peer rather than something else on the port. */
export function isValidGreeting(buf: Buffer): boolean {
  if (buf.length < GREETING_LENGTH) return false;
  return buf[0] === 0xff && buf[9] === 0x7f && (buf[10] ?? 0) >= 3;
}

export interface ZmtpSubscriberOptions {
  host: string;
  port: number;
  topic?: string;
  /** Delay before reconnecting after a drop. EDDN is a volunteer relay; do not hammer it. */
  reconnectDelayMs?: number;
  onMessage: (body: Buffer) => void;
  onError?: (err: Error) => void;
  onStateChange?: (state: "connecting" | "connected" | "closed") => void;
}

/**
 * A reconnecting SUB subscriber. `stop()` is final — it will not reconnect afterwards, which is what
 * makes it safe to call from a signal handler.
 */
export class ZmtpSubscriber {
  private socket: Socket | null = null;
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private greeted = false;
  private ready = false;
  private stopped = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: ZmtpSubscriberOptions) {}

  start(): void {
    if (this.stopped) return;
    this.opts.onStateChange?.("connecting");
    this.buffer = Buffer.alloc(0);
    this.greeted = false;
    this.ready = false;

    const socket = connect({ host: this.opts.host, port: this.opts.port });
    this.socket = socket;
    socket.on("connect", () => socket.write(GREETING));
    socket.on("data", (chunk) => this.onData(chunk));
    socket.on("error", (err) => {
      this.opts.onError?.(err);
      this.reconnect();
    });
    socket.on("close", () => this.reconnect());
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.destroy();
    this.socket = null;
    this.opts.onStateChange?.("closed");
  }

  private reconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.socket?.destroy();
    this.socket = null;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.start();
    }, this.opts.reconnectDelayMs ?? 5000);
  }

  private onData(chunk: Buffer<ArrayBufferLike>): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);

    if (!this.greeted) {
      if (this.buffer.length < GREETING_LENGTH) return;
      if (!isValidGreeting(this.buffer)) {
        this.opts.onError?.(new Error("peer did not send a ZMTP 3.x greeting"));
        this.socket?.destroy();
        return;
      }
      this.buffer = this.buffer.subarray(GREETING_LENGTH);
      this.greeted = true;
      this.socket?.write(readyFrame("SUB"));
    }

    for (;;) {
      const frame = readFrame(this.buffer);
      if (!frame) return;
      this.buffer = this.buffer.subarray(frame.size);

      if (frame.isCommand) {
        // The only command that matters here is the peer's READY; anything else (PING, ERROR) is
        // left alone deliberately rather than half-handled.
        const nameLen = frame.body.readUInt8(0);
        const name = frame.body.subarray(1, 1 + nameLen).toString("ascii");
        if (name === "READY" && !this.ready) {
          this.ready = true;
          this.socket?.write(subscribeFrame(this.opts.topic ?? ""));
          this.opts.onStateChange?.("connected");
        }
        continue;
      }
      if (frame.body.length > 0) this.opts.onMessage(frame.body);
    }
  }
}
