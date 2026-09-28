/**
 * The temperature and pressure units, one setting for the whole app (code review B17, 2026-09-28).
 *
 * The body pane, the species cards and the quick-facts popup each kept their own copy in React state:
 * clicking K → °C on a card changed that card, the body pane caught up only when it next mounted, and
 * the popup always opened in K and atm because it never read the saved choice. Now there is one value
 * per unit, saved where it always was, and every component using it re-renders when it changes — in
 * this window and, through the `storage` event, in any other app window.
 */
import { useSyncExternalStore } from "react";
import type { PressDisplay, TempUnit } from "./planetDisplayUtils";
import { readPressUnitFromLs, readTempUnitFromLs, writePressUnitToLs, writeTempUnitToLs } from "./lsPrefs";

function makeUnitStore<T>(read: () => T, write: (v: T) => void, lsKey: string) {
  let value: T | null = null;
  const listeners = new Set<() => void>();
  const get = (): T => {
    if (value === null) value = read();
    return value;
  };
  const set = (next: T | ((prev: T) => T)) => {
    const v = typeof next === "function" ? (next as (prev: T) => T)(get()) : next;
    if (v === value) return;
    value = v;
    write(v);
    for (const l of listeners) l();
  };
  const subscribe = (l: () => void) => {
    listeners.add(l);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== lsKey) return;
      value = read();
      l();
    };
    if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(l);
      if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
    };
  };
  return { get, set, subscribe };
}

const temp = makeUnitStore<TempUnit>(readTempUnitFromLs, writeTempUnitToLs, "edexo.bodyTempUnit");
const press = makeUnitStore<PressDisplay>(readPressUnitFromLs, writePressUnitToLs, "edexo.bodyPressUnit");

/** The app's temperature unit and its setter (a value or an updater, like `useState`). */
export function useTempUnit(): [TempUnit, (next: TempUnit | ((prev: TempUnit) => TempUnit)) => void] {
  return [useSyncExternalStore(temp.subscribe, temp.get, temp.get), temp.set];
}

/** The app's pressure unit and its setter. */
export function usePressUnit(): [
  PressDisplay,
  (next: PressDisplay | ((prev: PressDisplay) => PressDisplay)) => void,
] {
  return [useSyncExternalStore(press.subscribe, press.get, press.get), press.set];
}

/** K → °C → °F → K. */
export const nextTempUnit = (u: TempUnit): TempUnit => (u === "K" ? "C" : u === "C" ? "F" : "K");
