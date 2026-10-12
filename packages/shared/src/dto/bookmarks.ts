import { z } from 'zod';
import type { ConnectionDto, MapSystemDto, SignatureDto } from './mapping.js';

/**
 * Bookmark labels: the short name shown above a system, the one pilots type into their in-game
 * bookmark of the wormhole that leads there ("ABC-123", "1a C3 ABC"). A template mixes plain text
 * with variables in braces; a map has a default (managers set it) and every pilot may override it.
 */
export const BOOKMARK_VARIABLES = {
  sig: 'Signature of the wormhole into this system, in its parent system (ABC-123)',
  sig3: 'The letters of that signature (ABC)',
  chainIndex: 'Depth from home and the order among its siblings (1a, 1b, 2a)',
  destClass: 'Class of this system (C3, HS, LS, NS, Thera...)',
  type: 'Wormhole type of that signature (O477, K162)',
  size: 'Largest ship that fits (F, M, L, XL)',
  mass: 'Mass left when not fresh (reduced, crit)',
  eol: 'EOL when the wormhole is at the end of its life',
  tempName: "This system's temporary name",
} as const;

export type BookmarkVariable = keyof typeof BOOKMARK_VARIABLES;
export type BookmarkVars = Record<BookmarkVariable, string>;

export const DEFAULT_BOOKMARK_TEMPLATE = '{sig}';

/**
 * Where systems are placed next to each other, in canvas pixels: a step right for the next system
 * of a chain and a step down to find a free spot. Every system node has the same box (about 240 by
 * 100 with the bookmark tag above it), and a step leaves room for two badges on the line between.
 */
export const SYSTEM_PLACEMENT = { x: 360, y: 150 } as const;

const VARIABLE = /\{([A-Za-z0-9]+)\}/g;

/** Variables a template uses, unknown ones included (for validation messages). */
export function bookmarkTemplateVariables(template: string): string[] {
  return [...template.matchAll(VARIABLE)].map((m) => m[1]!);
}

/** A template: up to 64 characters, only known variables, at least one variable. */
export const BookmarkTemplate = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .superRefine((template, ctx) => {
    const used = bookmarkTemplateVariables(template);
    const unknown = used.filter((v) => !(v in BOOKMARK_VARIABLES));
    if (unknown.length > 0)
      ctx.addIssue({
        code: 'custom',
        message: `Unknown variable ${unknown.map((v) => `{${v}}`).join(', ')}`,
      });
    else if (used.length === 0) ctx.addIssue({ code: 'custom', message: 'Use at least one variable' });
  });

/** Ready-made templates offered in the settings, most common first. */
export const BOOKMARK_TEMPLATE_PRESETS: readonly string[] = [
  '{sig}',
  '{sig3} {destClass}',
  '{chainIndex} {sig}',
  '{destClass} {sig3}',
  '{chainIndex} {destClass} {sig3}',
  '{sig3} {destClass} {size} {eol}',
];

/** Fills a template; empty variables drop out and spaces collapse. */
export function renderBookmarkTemplate(template: string, vars: BookmarkVars): string {
  return template
    .replace(VARIABLE, (whole, name: string) =>
      name in BOOKMARK_VARIABLES ? vars[name as BookmarkVariable] : whole,
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Class labels of a system as bookmark text, from the SDE wormhole class and security. */
export function bookmarkClassLabel(info: { whClass: number | null; security: number } | undefined): string {
  if (!info) return '';
  const c = info.whClass;
  if (c !== null && c >= 1 && c <= 6) return `C${c}`;
  if (c === 12) return 'Thera';
  if (c === 13) return 'C13';
  if (c !== null && c >= 14 && c <= 18) return 'Drifter';
  if (c === 25) return 'Pochven';
  if (info.security >= 0.45) return 'HS';
  return info.security > 0 ? 'LS' : 'NS';
}

const SIZE_TEXT: Record<ConnectionDto['shipSize'], string> = {
  small: 'F',
  medium: 'M',
  large: 'L',
  xlarge: 'XL',
};

/** `0 -> a`, `25 -> z`, `26 -> aa`. */
function siblingLetter(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

export interface BookmarkChainInput {
  systems: readonly MapSystemDto[];
  connections: readonly ConnectionDto[];
  signatures: readonly SignatureDto[];
  /** Class label of a system (see `bookmarkClassLabel`); empty when not known yet. */
  classOf(solarSystemId: number): string;
}

/**
 * Walks the chain from its roots (systems with status `home`, else the oldest system of each
 * part of the map) and gives every reachable system the variables of the wormhole that leads into
 * it from its parent. Roots have no parent: their variables are empty but `destClass` and
 * `tempName`.
 */
export function bookmarkChain(input: BookmarkChainInput): Map<number, BookmarkVars & { root: boolean }> {
  const systems = input.systems.filter((s) => s.visible);
  const known = new Set(systems.map((s) => s.solarSystemId));
  const byId = new Map(systems.map((s) => [s.solarSystemId, s]));
  const links = new Map<number, ConnectionDto[]>();
  const connections = [...input.connections]
    .filter((c) => known.has(c.source) && known.has(c.target))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  for (const c of connections) {
    for (const end of [c.source, c.target]) links.set(end, [...(links.get(end) ?? []), c]);
  }
  const sigByConnection = new Map<string, SignatureDto[]>();
  for (const s of input.signatures) {
    if (s.connectionId)
      sigByConnection.set(s.connectionId, [...(sigByConnection.get(s.connectionId) ?? []), s]);
  }

  const result = new Map<number, BookmarkVars & { root: boolean }>();
  const base = (s: MapSystemDto): BookmarkVars => ({
    sig: '',
    sig3: '',
    chainIndex: '',
    destClass: input.classOf(s.solarSystemId),
    type: '',
    size: '',
    mass: '',
    eol: '',
    tempName: s.temporaryName ?? '',
  });

  const roots = [
    ...systems.filter((s) => s.status === 'home').sort((a, b) => a.createdAt - b.createdAt),
    ...[...systems].sort((a, b) => a.createdAt - b.createdAt || a.solarSystemId - b.solarSystemId),
  ];
  for (const root of roots) {
    if (result.has(root.solarSystemId)) continue;
    result.set(root.solarSystemId, { ...base(root), chainIndex: '0', root: true });
    const queue: { id: number; depth: number }[] = [{ id: root.solarSystemId, depth: 0 }];
    while (queue.length > 0) {
      const { id: parent, depth } = queue.shift()!;
      let sibling = 0;
      for (const c of links.get(parent) ?? []) {
        const child = c.source === parent ? c.target : c.source;
        if (result.has(child)) continue;
        const sig = (sigByConnection.get(c.id) ?? []).find((s) => s.solarSystemId === parent);
        result.set(child, {
          ...base(byId.get(child)!),
          sig: sig?.eveId ?? '',
          sig3: sig?.eveId.slice(0, 3) ?? '',
          chainIndex: `${depth + 1}${siblingLetter(sibling++)}`,
          type: sig?.type ?? '',
          size: SIZE_TEXT[c.shipSize],
          mass: c.massStatus === 'critical' ? 'crit' : c.massStatus === 'reduced' ? 'reduced' : '',
          eol: c.timeStatus === 'eol' ? 'EOL' : '',
          root: false,
        });
        queue.push({ id: child, depth: depth + 1 });
      }
    }
  }
  return result;
}

/**
 * The label shown above a system. A temporary name wins unless the template places it itself;
 * roots (home) show only a temporary name; nothing to show is null.
 */
export function bookmarkLabel(template: string, vars: BookmarkVars & { root: boolean }): string | null {
  const usesTempName = bookmarkTemplateVariables(template).includes('tempName');
  if (vars.tempName && !usesTempName) return vars.tempName;
  if (vars.root) return vars.tempName || null;
  // Without the signature of the hole there is nothing to bookmark yet.
  const needsSig = /\{sig3?\}/.test(template);
  if (needsSig && !vars.sig) return vars.tempName || null;
  const label = renderBookmarkTemplate(template, vars);
  return label || null;
}

/** Sample variables for previews in the settings. */
export const BOOKMARK_PREVIEW_VARS: BookmarkVars & { root: boolean } = {
  sig: 'ABC-123',
  sig3: 'ABC',
  chainIndex: '1a',
  destClass: 'C3',
  type: 'O477',
  size: 'L',
  mass: '',
  eol: '',
  tempName: '',
  root: false,
};

/**
 * GET/PATCH /api/maps/:mapId/preferences: one account's own view of a map. A viewport is the point
 * of the map (canvas coordinates) in the middle of the view and the zoom, so it restores on any
 * screen size.
 */
export const MapViewport = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  zoom: z.number().finite().min(0.05).max(4),
});
export type MapViewport = z.infer<typeof MapViewport>;

export const MapPreferencesDto = z.object({
  /** Where this account last left the map; null before the first visit. */
  viewport: MapViewport.nullable(),
  /** This account's bookmark label template; null follows the map's default. */
  bookmarkTemplate: z.string().nullable(),
  updatedAt: z.number().int().nonnegative(),
});
export type MapPreferencesDto = z.infer<typeof MapPreferencesDto>;

export const UpdateMapPreferencesRequest = z
  .object({ viewport: MapViewport.nullable(), bookmarkTemplate: BookmarkTemplate.nullable() })
  .partial();
export type UpdateMapPreferencesRequest = z.infer<typeof UpdateMapPreferencesRequest>;

/** PUT /api/maps/:mapId/bookmark-template (manager+): the map's default; null resets to `{sig}`. */
export const SetBookmarkTemplateRequest = z.object({ template: BookmarkTemplate.nullable() });
export type SetBookmarkTemplateRequest = z.infer<typeof SetBookmarkTemplateRequest>;
