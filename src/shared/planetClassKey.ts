/**
 * One key for a planet class, whoever is spelling it.
 *
 * Three vocabularies for five classes. The journal writes `High metal content body`, EDSM — and so
 * every feeder profile — writes `High metal content world`, and the codex rows in `<genus>_new.json`
 * write `High Metal Content`. §27 is what happens when two of those are compared as free text, and
 * this is the same hazard one field over.
 *
 * The trailing noun is the part that differs and the part that carries no information: a "world" and
 * a "body" are the same thing, and the class is everything before it.
 */
export function planetClassKey(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(body|world|planet)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the two spellings mean the same class. Empty on either side is not a match. */
export function planetClassMatches(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = planetClassKey(a);
  const kb = planetClassKey(b);
  return ka.length > 0 && ka === kb;
}
