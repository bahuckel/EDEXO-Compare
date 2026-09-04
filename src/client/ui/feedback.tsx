import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useModal } from "./useModal";

/**
 * Toasts and a styled confirm, replacing `window.alert` / `window.confirm`.
 *
 * There were 15 `window.alert` calls — every one of them a failed settings POST — and one
 * `window.confirm` guarding the exobiology reset. In Electron those are modal OS dialogs: they
 * freeze the renderer, look nothing like the app, and cannot be styled or dismissed by the page.
 *
 * `useToast()` returns `info` / `success` / `error`; `useConfirm()` returns a promise that resolves
 * to the user's answer. Both are available anywhere under <UiFeedbackProvider>.
 */

type ToastKind = "info" | "success" | "error";

type ToastItem = {
  id: number;
  kind: ToastKind;
  text: string;
};

type ConfirmRequest = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "neutral";
};

type FeedbackApi = {
  push: (kind: ToastKind, text: string) => void;
  confirm: (req: ConfirmRequest) => Promise<boolean>;
};

const FeedbackContext = createContext<FeedbackApi | null>(null);

/** Errors linger; confirmations are read at a glance. */
const TOAST_MS: Record<ToastKind, number> = { info: 4500, success: 3500, error: 9000 };
const MAX_VISIBLE_TOASTS = 4;

let nextToastId = 1;

export function UiFeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<
    (ConfirmRequest & { resolve: (ok: boolean) => void }) | null
  >(null);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t != null) window.clearTimeout(t);
    timers.current.delete(id);
    setToasts((list) => list.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, text: string) => {
      const id = nextToastId++;
      setToasts((list) => [...list, { id, kind, text }].slice(-MAX_VISIBLE_TOASTS));
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), TOAST_MS[kind]),
      );
    },
    [dismiss],
  );

  const confirm = useCallback(
    (req: ConfirmRequest) =>
      new Promise<boolean>((resolve) => {
        setConfirmState({ ...req, resolve });
      }),
    [],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) window.clearTimeout(t);
      map.clear();
    };
  }, []);

  const api = useMemo<FeedbackApi>(() => ({ push, confirm }), [push, confirm]);

  const answerConfirm = useCallback((ok: boolean) => {
    setConfirmState((state) => {
      state?.resolve(ok);
      return null;
    });
  }, []);

  return (
    <FeedbackContext.Provider value={api}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
      {confirmState ? <ConfirmDialog request={confirmState} onAnswer={answerConfirm} /> : null}
    </FeedbackContext.Provider>
  );
}

function ToastStack({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return createPortal(
    <div className="toast-stack" role="region" aria-label="Notifications">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast toast--${t.kind}`}
          role={t.kind === "error" ? "alert" : "status"}
          aria-live={t.kind === "error" ? "assertive" : "polite"}
        >
          <span className="toast-text">{t.text}</span>
          <button
            type="button"
            className="toast-close"
            onClick={() => onDismiss(t.id)}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

function ConfirmDialog({ request, onAnswer }: { request: ConfirmRequest; onAnswer: (ok: boolean) => void }) {
  const cancel = useCallback(() => onAnswer(false), [onAnswer]);
  const dialogRef = useModal<HTMLDivElement>(true, cancel);

  return createPortal(
    <div className="modal-backdrop confirm-backdrop" onClick={cancel} role="presentation">
      <div
        ref={dialogRef}
        className="modal confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        tabIndex={-1}
        onClick={(ev) => ev.stopPropagation()}
      >
        <h3 id="confirm-title" className="confirm-title">
          {request.title}
        </h3>
        <p id="confirm-body" className="confirm-body">
          {request.message}
        </p>
        <div className="confirm-actions">
          <button type="button" className="btn-confirm-cancel" onClick={cancel}>
            {request.cancelLabel ?? "Cancel"}
          </button>
          <button
            type="button"
            className={request.tone === "danger" ? "btn-confirm-go btn-confirm-go--danger" : "btn-confirm-go"}
            onClick={() => onAnswer(true)}
          >
            {request.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function useFeedback(): FeedbackApi {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error("useToast/useConfirm must be used inside <UiFeedbackProvider>");
  return ctx;
}

export function useToast() {
  const { push } = useFeedback();
  return useMemo(
    () => ({
      info: (text: string) => push("info", text),
      success: (text: string) => push("success", text),
      error: (text: string) => push("error", text),
    }),
    [push],
  );
}

export function useConfirm() {
  return useFeedback().confirm;
}
