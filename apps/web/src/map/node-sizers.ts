// No imports: next.config.ts loads this file at build time.

/**
 * The system names that could be the widest in the node's name font: every name within three
 * letters of the longest one (a shorter name of wide letters can outgrow a longer one of narrow
 * letters). The node lays them out invisibly, so its width is exactly what the widest of them
 * needs in whatever font the theme uses, without measuring anything in JavaScript.
 */
export function nodeNameSizers(names: Iterable<string>, slack = 3): string[] {
  const unique = [...new Set(names)];
  const longest = Math.max(0, ...unique.map((n) => n.length));
  return unique
    .filter((n) => n.length >= longest - slack)
    .sort((a, b) => b.length - a.length || a.localeCompare(b));
}

/**
 * Filled in at build time by next.config.ts from the universe dataset (`DBK_NODE_NAME_SIZERS`, a
 * JSON array); empty in tests and before a build, where the node falls back to its minimum width.
 */
export function builtNodeNameSizers(): string[] {
  try {
    const raw = process.env.DBK_NODE_NAME_SIZERS;
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string') : [];
  } catch {
    return [];
  }
}
