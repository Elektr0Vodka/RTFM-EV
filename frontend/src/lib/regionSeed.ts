/**
 * Merge reported region codes (e.g. a repeater's `region` dump: nl, nl-nh, eu)
 * into an existing `known_regions` list. Mirrors the backend `_dedupe_region_names`
 * rules: drop the wildcard `*` and blanks, dedupe case-insensitively, and compare
 * against existing codes case-insensitively so a repeater's regions can seed
 * `known_regions` without introducing duplicates.
 *
 * Returns the merged list (existing order preserved, new codes appended in
 * first-seen order) and the list of codes that were actually added.
 */
export function computeRegionSeed(
  existing: string[],
  reported: string[]
): { merged: string[]; added: string[] } {
  const knownLower = new Set(existing.map((r) => r.trim().toLowerCase()));
  const added: string[] = [];
  const seen = new Set<string>();
  for (const raw of reported) {
    const code = (raw || '').trim();
    const lower = code.toLowerCase();
    if (!code || code === '*' || seen.has(lower) || knownLower.has(lower)) continue;
    seen.add(lower);
    added.push(code);
  }
  return { merged: [...existing, ...added], added };
}
