/**
 * Golden boxel positions for stars, worlds and signals (owner, 2026-10-06): the same letters in every sector
 * where a target is more common than in the rest of its mass code. From the Spansh galaxy dump
 * (docs/perf/boxel_position_study.py + boxel_golden.py, Bonferroni over every position x target, both halves of
 * the galaxy), kept only when it still holds in boxels at least 90 % explored (boxel_golden_survey.py: survey
 * bias) and is at least 1.75x over all boxels. Most sit in the sector's lowest layers, near the galactic plane.
 * [target, mass code, position, systems, hits, rest's share, liftInExploredBoxels]; written by
 * docs/perf/boxel_position_golden_ts.py.
 */
export const BOXEL_POSITION_GOLDEN: readonly (readonly [string, string, number, number, number, number, number])[] = [
  ["bio", "g", 0, 47005, 4479, 0.048231, 2.36],
  ["bio", "d", 32897, 14873, 1864, 0.068361, 1.85],
  ["bio", "d", 33026, 11116, 1339, 0.068373, 2.17],
  ["geo", "g", 0, 47005, 5483, 0.052472, 3.2],
  ["star:AeBe", "f", 33027, 3480, 721, 0.0889, 1.8],
  ["star:D", "d", 50817, 5454, 230, 0.016119, 17.19],
  ["star:D", "e", 98433, 4737, 234, 0.021097, 5.58],
  ["star:D", "e", 114817, 4871, 236, 0.021097, 26.31],
  ["star:D", "e", 82049, 5255, 248, 0.021095, 11.12],
  ["star:D", "e", 32897, 6221, 267, 0.021096, 8.35],
  ["star:D", "e", 114816, 4667, 183, 0.021121, 12.22],
  ["star:D", "e", 132, 4435, 168, 0.021126, 7.4],
  ["star:D", "f", 1, 8734, 900, 0.057961, 4.62],
  ["star:H", "e", 114817, 4871, 355, 0.038657, 7.0],
  ["star:H", "e", 114816, 4667, 321, 0.03867, 5.56],
  ["star:M", "e", 98432, 4888, 605, 0.067622, 4.27],
  ["star:M", "e", 114817, 4871, 596, 0.067626, 4.94],
  ["star:M", "e", 98433, 4737, 575, 0.067632, 3.1],
  ["star:M", "e", 114816, 4667, 558, 0.067638, 2.94],
  ["star:N", "e", 130, 5769, 3215, 0.271263, 2.71],
  ["star:N", "e", 16519, 5378, 2974, 0.27133, 3.72],
  ["star:N", "e", 98432, 4888, 2672, 0.271413, 7.34],
  ["star:N", "e", 114817, 4871, 2630, 0.271431, 9.8],
  ["star:N", "e", 98433, 4737, 2539, 0.271458, 8.53],
  ["star:N", "e", 82049, 5255, 2773, 0.271412, 5.77],
  ["star:N", "e", 32900, 6315, 3288, 0.2713, 4.04],
  ["star:N", "e", 49281, 5366, 2710, 0.271458, 4.66],
  ["star:N", "e", 82052, 4951, 2463, 0.271523, 7.52],
  ["star:N", "e", 114816, 4667, 2298, 0.271566, 6.29],
  ["star:N", "e", 16518, 4936, 2414, 0.271545, 2.13],
  ["star:N", "e", 133, 5550, 2638, 0.271517, 2.66],
  ["star:TTS", "d", 33026, 11116, 203, 0.007236, 9.92],
  ["star:TTS", "d", 32898, 13924, 210, 0.007237, 3.55],
  ["star:Y", "d", 33666, 4368, 474, 0.058654, 3.7],
];
