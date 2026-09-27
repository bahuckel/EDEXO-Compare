/**
 * Is this `TerraformState` a terraforming candidate?
 *
 * The journal writes "Terraformable" (or "" when not); EDSM and Spansh write "Candidate for
 * terraforming" and "Not terraformable". The old test, `includes("terraformable")`, read "Not
 * terraformable" as a yes — every body from those sources was starred and valued as terraformable.
 */
export function isTerraformableState(state: string | null | undefined): boolean {
  const s = (state ?? "").trim().toLowerCase();
  if (!s || s.startsWith("not ")) return false;
  return s.includes("terraformable") || s.includes("candidate for terraforming");
}
