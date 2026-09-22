/**
 * The console's HTTP client, pointed at whichever instance it is driving.
 *
 * The console build starts its own server, and that is not always the one worth talking to: the
 * commander is usually playing with the desktop app open, and the interesting state — the overlay
 * windows, the journal being tailed, the system in front of them — is over there. So the target is a
 * base URL that `network connect` can move, and every command goes through here.
 *
 * Loopback never needs the LAN access key (see `lanAuth.ts`), which is why connecting to
 * `127.0.0.1:7111` just works. A key is only carried when one is supplied for a remote target.
 */

export interface CliTarget {
  base: string;
  /** Present only for a non-loopback target; loopback is trusted by the server itself. */
  key?: string;
  /** True when this is the server this console process started. */
  own: boolean;
}

export interface CliResponse {
  status: number;
  ok: boolean;
  body: unknown;
}

/** `7111` → `http://127.0.0.1:7111`; `box:7111` and a full URL are both taken as meant. */
export function normalizeTarget(input: string): string {
  const raw = input.trim().replace(/\/+$/, "");
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^\d+$/.test(raw)) return `http://127.0.0.1:${raw}`;
  return `http://${raw.includes(":") ? raw : `${raw}:7111`}`;
}

export class CliClient {
  constructor(
    private target: CliTarget,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  get current(): CliTarget {
    return this.target;
  }

  setTarget(target: CliTarget): void {
    this.target = target;
  }

  async request(method: "GET" | "POST", path: string, body?: unknown): Promise<CliResponse> {
    const url = `${this.target.base}${path}`;
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.target.key) headers["x-edexo-lan-key"] = this.target.key;
    try {
      const res = await this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        /* a non-JSON body is still worth showing */
      }
      return { status: res.status, ok: res.ok, body: parsed };
    } catch (e) {
      /*
        A dead target is the common case, not an exceptional one: the app gets closed, or the port
        was a typo. It comes back as a status of 0 so callers print a reason instead of a stack.
      */
      return { status: 0, ok: false, body: { error: e instanceof Error ? e.message : String(e) } };
    }
  }

  get(path: string): Promise<CliResponse> {
    return this.request("GET", path);
  }

  post(path: string, body?: unknown): Promise<CliResponse> {
    return this.request("POST", path, body ?? {});
  }
}

/** The message a failed call should print: the server's own words when it gave any. */
export function describeFailure(res: CliResponse, target: CliTarget): string {
  const b = res.body as { error?: unknown } | null;
  const reason = b && typeof b.error === "string" ? b.error : null;
  if (res.status === 0) {
    return `Cannot reach ${target.base} — ${reason ?? "no answer"}.${
      target.own ? "" : "  /network connect with no argument goes back to this console's own server."
    }`;
  }
  if (res.status === 401) {
    return `${target.base} refused the request: that instance is on another machine and needs its access key.`;
  }
  return reason ?? `${res.status} from ${target.base}.`;
}
