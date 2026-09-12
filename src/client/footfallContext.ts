import { createContext, useContext } from "react";
import type { FootfallCertainty } from "@shared/footfallValue";

/**
 * The body's first-footfall answer, for every species card under it (WEBUI-REDESIGN 1.1 / 1.2).
 *
 * `walked` → the card's value is the list price. `unwalked` → the card's value is ×5, because that
 * is what the plant pays here. `unknown` → list price with the ×5 one hover away. Provided by the
 * body pane so the genus groups and cards do not have to thread it through three levels of props.
 */
export const FootfallContext = createContext<FootfallCertainty>("unknown");

export function useFootfallCertainty(): FootfallCertainty {
  return useContext(FootfallContext);
}
