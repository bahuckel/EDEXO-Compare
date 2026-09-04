import { ELITE_TIPS } from "./eliteTips";
import { useEffect, useRef, useState } from "react";

const ELITE_TIP_FADE_MS = 550;
const ELITE_TIP_ROTATE_MS = 60_000;

function makeShuffledIndices(len: number): number[] {
  const a = Array.from({ length: len }, (_, i) => i);
  for (let i = len - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

export function EliteTipRotator() {
  const orderRef = useRef<number[] | null>(null);
  if (orderRef.current === null) {
    orderRef.current = makeShuffledIndices(ELITE_TIPS.length);
  }
  const order = orderRef.current;
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const id = window.setInterval(() => {
      setVisible(false);
      window.setTimeout(() => {
        setIdx((prev) => (prev + 1) % order.length);
        setVisible(true);
      }, ELITE_TIP_FADE_MS);
    }, ELITE_TIP_ROTATE_MS);
    return () => window.clearInterval(id);
  }, [order.length]);

  const tip = ELITE_TIPS[order[idx]!]!;

  return (
    <p
      className={`elite-tip-line${visible ? " elite-tip-line--show" : ""}`}
      aria-live="polite"
      aria-label={`Gameplay tip: ${tip}`}
    >
      <span className="elite-tip-prefix">Tip: </span>
      {tip}
    </p>
  );
}
