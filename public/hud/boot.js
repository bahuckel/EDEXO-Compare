/*
  Mounts the HUD sections a page names (Phase 6: was an inline module script in each overlay page,
  which a Content-Security-Policy without 'unsafe-inline' does not run). A single-section page says
  which on <body data-sections="distance">; the merged HUD names none and reads its query string.
*/
import { HUD } from "./main.js";

const named = document.body.dataset.sections;
HUD.mount(named ? named.split(",") : HUD.sectionsFromUrl());
