import { useCallback, useEffect, useState, type ReactNode } from "react";

const HELP_LS_PREFIX = "edexo.help.";

/**
 * The fold — the app's one collapse gesture (WEBUI-REDESIGN 2.5 / 4.1).
 *
 * Every panel gets the same header (chevron, title, one-line summary that appears only while
 * folded, and an aside for the panel's own controls), the same motion (grid rows 1fr → 0fr with a
 * fade, `prefers-reduced-motion` respected in CSS) and the same memory: the open/closed state is
 * remembered per key in localStorage, so a panel a commander folded stays folded across bodies and
 * launches.
 */

const LS_PREFIX = "edexo.fold.";

function readFold(key: string, def: boolean): boolean {
  try {
    const v = localStorage.getItem(LS_PREFIX + key);
    return v == null ? def : v === "1";
  } catch {
    return def;
  }
}

export function useFold(key: string, defaultOpen = true): [boolean, () => void, (v: boolean) => void] {
  const [open, setOpenState] = useState<boolean>(() => readFold(key, defaultOpen));
  // A key change (another panel reusing the hook) reads its own memory.
  useEffect(() => {
    setOpenState(readFold(key, defaultOpen));
  }, [key, defaultOpen]);
  const setOpen = useCallback(
    (v: boolean) => {
      setOpenState(v);
      try {
        localStorage.setItem(LS_PREFIX + key, v ? "1" : "0");
      } catch {
        /* private window: the state still applies for this session */
      }
    },
    [key],
  );
  const toggle = useCallback(() => setOpen(!readFold(key, defaultOpen)), [key, defaultOpen, setOpen]);
  return [open, toggle, setOpen];
}

export function FoldPanel({
  foldKey,
  title,
  summary,
  aside,
  help,
  defaultOpen = true,
  className = "",
  bodyClassName = "",
  children,
}: {
  /** localStorage key; also the id base for aria wiring. */
  foldKey: string;
  title: ReactNode;
  /** Shown in the header only while folded: what the panel would say at a glance. */
  summary?: ReactNode;
  /** The panel's own controls (toggles, copy), kept out of the toggle button. */
  aside?: ReactNode;
  /**
   * The explanations that used to live in 300-character tooltips (WEBUI-REDESIGN 5.3): a "?" in
   * the head opens them as a drawer above the content. Tooltips stay one sentence.
   */
  help?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  const [open, toggle, setOpen] = useFold(foldKey, defaultOpen);
  const [helpOpen, setHelpOpen] = useState<boolean>(() => readFold(HELP_LS_PREFIX + foldKey, false));
  const toggleHelp = () => {
    const next = !helpOpen;
    setHelpOpen(next);
    if (next && !open) setOpen(true);
    try {
      localStorage.setItem(LS_PREFIX + HELP_LS_PREFIX + foldKey, next ? "1" : "0");
    } catch {
      /* private window */
    }
  };
  const panelId = `fold-${foldKey}`;
  return (
    <section className={`fold panel${open ? "" : " fold--closed"}${className ? ` ${className}` : ""}`}>
      <div className="fold-head">
        <button
          type="button"
          className="fold-toggle"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={panelId}
          title={open ? "Fold this panel" : "Unfold this panel"}
        >
          <span className="fold-chevron" aria-hidden="true" />
          <span className="fold-title">{title}</span>
          {summary != null ? <span className="fold-summary">{summary}</span> : null}
        </button>
        {aside ? <div className="fold-aside">{aside}</div> : null}
        {help ? (
          <button
            type="button"
            className={`fold-help-btn${helpOpen ? " fold-help-btn--on" : ""}`}
            onClick={toggleHelp}
            aria-expanded={helpOpen}
            aria-controls={`${panelId}-help`}
            title={helpOpen ? "Hide the explanations" : "What do these mean?"}
          >
            ?
          </button>
        ) : null}
      </div>
      <div id={panelId} className="fold-body" aria-hidden={!open}>
        <div className={`fold-inner${bodyClassName ? ` ${bodyClassName}` : ""}`}>
          {help && helpOpen ? (
            <div id={`${panelId}-help`} className="fold-help">
              {help}
            </div>
          ) : null}
          {children}
        </div>
      </div>
    </section>
  );
}
