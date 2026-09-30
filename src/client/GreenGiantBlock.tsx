/**
 * The green gas giant lines in a body's details (shared/greenGasGiant.ts): the verdict and why, and the
 * commander's own call — "it is green" confirms one the numbers cannot see (a new temperature), "not
 * green" silences a guess. Shown on every gas giant of a class that can be green, so a find at an
 * unknown temperature can still be marked. Also the body features he switched on, with their reasons.
 */
import { useState } from "react";
import type { SystemMapBodyDetailDTO } from "@shared/types";
import { EDGGG_URL, greenGiantIsNewFind, greenGiantLabel, isGggClass, type GreenGiantMark } from "@shared/greenGasGiant";

async function postMark(systemAddress: number, bodyId: number, mark: GreenGiantMark | null): Promise<boolean> {
  try {
    const r = await fetch("/api/ggg/mark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ systemAddress, bodyId, mark }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

function systemAddressOf(bodyKey: string): number | null {
  const n = Number(bodyKey.slice(0, bodyKey.indexOf(":")));
  return Number.isFinite(n) ? n : null;
}

export function GreenGiantBlock({ detail }: { detail: SystemMapBodyDetailDTO }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!isGggClass(detail.planetClass) || detail.greenMark === undefined) return null;
  const v = detail.green ?? null;
  const mark = detail.greenMark;
  const addr = systemAddressOf(detail.bodyKey);

  const send = (m: GreenGiantMark | null) => {
    if (addr == null) return;
    setBusy(true);
    setFailed(false);
    void postMark(addr, detail.bodyId, m).then((ok) => {
      setBusy(false);
      if (!ok) setFailed(true);
    });
  };

  return (
    <div className={`body-ggg${v ? ` body-ggg--${v.level}` : ""}`} role="group" aria-label="Green gas giant">
      <div className="body-ggg__head">
        <span className="body-ggg__dot" aria-hidden />
        <strong>{v ? greenGiantLabel(v) : "Green gas giant?"}</strong>
        {v ? <span className="body-ggg__why">{v.why}</span> : null}
      </div>
      {!v ? (
        <p className="body-ggg__hint">If it looks green in the FSS or up close, mark it — the temperature is not always known.</p>
      ) : null}
      {greenGiantIsNewFind(v) ? (
        <p className="body-ggg__hint">
          Not in the edGGG catalogue — possibly a new find.{" "}
          <a href={EDGGG_URL} target="_blank" rel="noopener noreferrer">
            edGGG
          </a>{" "}
          lists every known one.
        </p>
      ) : null}
      <div className="body-ggg__actions">
        <button type="button" className="body-ggg__btn" disabled={busy || mark === "yes"} onClick={() => send("yes")}>
          It&apos;s green
        </button>
        <button type="button" className="body-ggg__btn" disabled={busy || mark === "no"} onClick={() => send("no")}>
          Not green
        </button>
        {mark ? (
          <button type="button" className="body-ggg__btn body-ggg__btn--quiet" disabled={busy} onClick={() => send(null)}>
            Clear my call
          </button>
        ) : null}
        {failed ? <span className="body-ggg__err">Not saved — try again.</span> : null}
      </div>
    </div>
  );
}

export function BodyFeatureLines({ detail }: { detail: SystemMapBodyDetailDTO }) {
  if (!detail.features?.length) return null;
  return (
    <ul className="body-features" aria-label="Body features">
      {detail.features.map((f) => (
        <li key={f.key}>
          <strong>{f.label}</strong> <span className="dim">— {f.why}</span>
        </li>
      ))}
    </ul>
  );
}
