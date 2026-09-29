/**
 * `useState` that the next opening of the panel remembers (guild tester report, 2026-09-30: "have all
 * the sections with filters remember the selected filter settings when coming back to them").
 *
 * The panels are unmounted when closed, so plain state reset every time. This keeps the value in
 * localStorage under `edexo.filters.<key>`; what is read back must pass `valid`, or the default is
 * used — a stale or hand-edited value can never break a panel. Search boxes are deliberately not
 * remembered: a search is a question of the moment.
 */
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

const PREFIX = "edexo.filters.";

export function usePersistedState<T>(
  key: string,
  initial: T | (() => T),
  valid: (v: unknown) => v is T,
  /** Applied to a value read back, before use (e.g. to clear a search field kept inside an object). */
  onLoad?: (v: T) => T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (raw != null) {
        const parsed: unknown = JSON.parse(raw);
        if (valid(parsed)) return onLoad ? onLoad(parsed) : parsed;
      }
    } catch {
      /* private window, blocked storage, bad JSON: the default */
    }
    return typeof initial === "function" ? (initial as () => T)() : initial;
  });
  useEffect(() => {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* not remembered, still works */
    }
  }, [key, value]);
  return [value, setValue];
}

export const isBool = (v: unknown): v is boolean => typeof v === "boolean";
export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const isStr = (v: unknown): v is string => typeof v === "string" && v.length <= 200;
export const isStrOrNull = (v: unknown): v is string | null => v === null || isStr(v);
export const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 100 && v.every(isStr);
export const oneOf =
  <const K extends string>(...ks: K[]) =>
  (v: unknown): v is K =>
    typeof v === "string" && (ks as string[]).includes(v);
