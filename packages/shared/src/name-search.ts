/**
 * Where a search finds a system name: 0 at the start, more inside, -1 nowhere. Both are
 * lower-case. Dashes in the name are skipped until the query has one, so "cj6" finds C-J6MT.
 */
export function nameMatch(key: string, query: string): number {
  return (query.includes('-') ? key : key.replaceAll('-', '')).indexOf(query);
}
