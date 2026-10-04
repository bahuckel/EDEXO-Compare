/**
 * A body's key across the app: `"<SystemAddress>:<BodyID>"`. It was written by hand in seven
 * functions and two dozen templates, and taken apart with `Number(key.split(":")[0])` in six more
 * (Phase 6 dedupe); one definition keeps every map keyed the same way.
 */
export function bodyKey(systemAddress: number, bodyId: number): string {
  return `${systemAddress}:${bodyId}`;
}

/** The system address in a body key; NaN when the key is not one. */
export function systemAddressOfBodyKey(key: string): number {
  const i = key.indexOf(":");
  return i <= 0 ? Number.NaN : Number(key.slice(0, i));
}

/** The body ID in a body key; NaN when the key is not one. */
export function bodyIdOfBodyKey(key: string): number {
  const i = key.indexOf(":");
  return i < 0 || i === key.length - 1 ? Number.NaN : Number(key.slice(i + 1));
}
