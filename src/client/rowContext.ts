import { createContext, useContext } from "react";
import type { OrganicGenusLock } from "@shared/types";

/**
 * What the species rows need from the body and the live game that the match itself does not carry
 * (WEBUI-REDESIGN 3.6): the on-foot genus locks on this body, and the sampling run in progress if
 * it is on this body. Provided by the body pane.
 */
export interface LiveRun {
  speciesDisplay: string;
  sampleCount: number;
}

export interface RowContextValue {
  locks: readonly OrganicGenusLock[];
  live: LiveRun | null;
}

export const RowContext = createContext<RowContextValue>({ locks: [], live: null });

export function useRowContext(): RowContextValue {
  return useContext(RowContext);
}
