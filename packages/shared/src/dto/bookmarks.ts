import { z } from 'zod';
import { EveId } from './common.js';
import type { ConnectionDto, MapSystemDto, SignatureDto, SystemLabelDto } from './mapping.js';

/**
 * Bookmark labels: the short name shown above a system, the one pilots type into their in-game
 * bookmark of the wormhole that leads there ("ABC-123", "1a C3 ABC"). A template mixes plain text
 * with variables in braces; a map has a default (managers set it) and every pilot may override it.
 */
export const BOOKMARK_VARIABLES = {
  sig: 'Signature of the wormhole into this system, in its parent system (ABC-123)',
  sig3: 'The letters of that signature (ABC)',
  chainIndex: 'Depth from home and the order among its siblings (1a, 1b, 2a)',
  n: 'Number of this wormhole among the wormholes out of its parent system (1, 2, 3)',
  N: 'The same number with two digits (01, 02, 03)',
  destClass: 'Class of this system (C3, HS, LS, NS, Thera...)',
  type: 'Wormhole type of that signature (O477, K162)',
  size: 'Largest ship that fits (F, M, L, XL)',
  mass: 'Mass left when not fresh (reduced, crit)',
  eol: 'EOL when the wormhole is at the end of its life',
  tempName: "This system's temporary name",
  labels: "This system's Labels and custom label (WH1 bait)",
} as const;

export type BookmarkVariable = keyof typeof BOOKMARK_VARIABLES;
export type BookmarkVars = Record<BookmarkVariable, string>;

export const DEFAULT_BOOKMARK_TEMPLATE = '{sig}';

/**
 * How the wormholes out of one system are numbered for `{n}`: in the order they were found, by
 * the signature in that system (A to Z, unknown last), by the class of the system they lead to
 * (HS, LS, NS, C1 to C6, then the rest) or by hand.
 */
export const BookmarkOrder = z.enum(['found', 'signature', 'class', 'manual']);
export type BookmarkOrder = z.infer<typeof BookmarkOrder>;

export const BOOKMARK_ORDERS: Record<BookmarkOrder, { label: string; description: string }> = {
  found: { label: 'Found', description: 'The order the wormholes were mapped' },
  signature: { label: 'Signature', description: 'Signature A to Z, unknown ones last' },
  class: { label: 'Class', description: 'HS, LS, NS, C1 to C6, then the rest' },
  manual: { label: 'By hand', description: 'Move numbers up and down yourself' },
};

/**
 * The map's numbering. Numbers are kept on the server, the same for everyone, and stay put: a
 * closed wormhole leaves a gap that the next new one fills (the lowest free number). With
 * `renumberOnClose` the siblings close the gap instead.
 */
export const BookmarkNumbering = z.object({
  order: BookmarkOrder.default('found'),
  renumberOnClose: z.boolean().default(false),
});
export type BookmarkNumbering = z.infer<typeof BookmarkNumbering>;

export const DEFAULT_BOOKMARK_NUMBERING: BookmarkNumbering = { order: 'found', renumberOnClose: false };

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
  'WH{n}',
  'WH{n} {destClass}',
  '{n} {sig3}',
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

const CLASS_RANK: Record<string, number> = {
  HS: 0,
  LS: 1,
  NS: 2,
  C1: 3,
  C2: 4,
  C3: 5,
  C4: 6,
  C5: 7,
  C6: 8,
};

/** Where a class label sorts for the `class` order: HS, LS, NS, C1 to C6, the rest, unknown last. */
export function bookmarkClassRank(label: string): number {
  if (!label) return 11;
  return CLASS_RANK[label] ?? 10;
}

/** What the orders sort a wormhole by, among the wormholes out of the same system. */
export interface BookmarkSibling {
  connectionId: string;
  /** When the connection was mapped. */
  createdAt: number;
  /** The wormhole's signature in the parent system, null while unknown. */
  signature: string | null;
  /** Class label of the system it leads to (see `bookmarkClassLabel`). */
  destClass: string;
  /** Its number now; null when it has none yet. */
  number: number | null;
}

const byFound = (a: BookmarkSibling, b: BookmarkSibling) =>
  a.createdAt - b.createdAt || a.connectionId.localeCompare(b.connectionId);

/** Compares two siblings in `order`; ties (and `found`) go by when they were mapped. */
export function compareBookmarkSiblings(order: BookmarkOrder) {
  return (a: BookmarkSibling, b: BookmarkSibling): number => {
    switch (order) {
      case 'signature': {
        if (a.signature !== b.signature) {
          if (a.signature === null) return 1;
          if (b.signature === null) return -1;
          return a.signature < b.signature ? -1 : 1;
        }
        return byFound(a, b);
      }
      case 'class':
        return bookmarkClassRank(a.destClass) - bookmarkClassRank(b.destClass) || byFound(a, b);
      case 'manual':
        return (a.number ?? Infinity) - (b.number ?? Infinity) || byFound(a, b);
      default:
        return byFound(a, b);
    }
  };
}

/** One step of the chain: `child` is reached from `parent` through `connection`. */
export interface ChainStep {
  parent: number;
  child: number;
  connection: ConnectionDto;
  /** Steps from the root; the first systems out of a root are at depth 1. */
  depth: number;
}

/**
 * The chain as a tree, walked breadth first from its roots: systems with status `home` (oldest
 * first), then the oldest system of every part of the map without one. Hidden systems are left
 * out; connections are taken oldest first. Every visible system is either a root or the child
 * of exactly one step.
 */
export function chainTree(
  allSystems: readonly MapSystemDto[],
  allConnections: readonly ConnectionDto[],
): { roots: number[]; steps: ChainStep[] } {
  const systems = allSystems.filter((s) => s.visible);
  const known = new Set(systems.map((s) => s.solarSystemId));
  const links = new Map<number, ConnectionDto[]>();
  const connections = [...allConnections]
    .filter((c) => known.has(c.source) && known.has(c.target))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  for (const c of connections) {
    for (const end of [c.source, c.target]) links.set(end, [...(links.get(end) ?? []), c]);
  }
  const candidates = [
    ...systems.filter((s) => s.status === 'home').sort((a, b) => a.createdAt - b.createdAt),
    ...[...systems].sort((a, b) => a.createdAt - b.createdAt || a.solarSystemId - b.solarSystemId),
  ];
  const seen = new Set<number>();
  const roots: number[] = [];
  const steps: ChainStep[] = [];
  for (const root of candidates) {
    if (seen.has(root.solarSystemId)) continue;
    seen.add(root.solarSystemId);
    roots.push(root.solarSystemId);
    const queue: { id: number; depth: number }[] = [{ id: root.solarSystemId, depth: 0 }];
    while (queue.length > 0) {
      const { id: parent, depth } = queue.shift()!;
      for (const c of links.get(parent) ?? []) {
        const child = c.source === parent ? c.target : c.source;
        if (seen.has(child)) continue;
        seen.add(child);
        steps.push({ parent, child, connection: c, depth: depth + 1 });
        queue.push({ id: child, depth: depth + 1 });
      }
    }
  }
  return { roots, steps };
}

/** Wormholes number; stargates and jump bridges do not. */
export function numbersBookmark(connection: Pick<ConnectionDto, 'type'>): boolean {
  return connection.type === 'wormhole';
}

const SIZE_TEXT: Record<ConnectionDto['shipSize'], string> = {
  small: 'F',
  medium: 'M',
  large: 'L',
  xlarge: 'XL',
  capital: 'C',
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
  /**
   * A viewer's own order for `{n}`. Left out, `{n}` is the number the server keeps for the map
   * (the same for everyone); given, the wormholes out of each system are numbered 1, 2, 3 in this
   * order on this screen only.
   */
  order?: BookmarkOrder | undefined;
  /** The map's Labels, for `{labels}`; left out, `{labels}` has only the custom label. */
  systemLabels?: readonly SystemLabelDto[] | undefined;
}

/** `{labels}` of a system: its Labels in the map's order, then its custom label. */
export function systemLabelsText(
  system: Pick<MapSystemDto, 'systemLabelIds' | 'customLabel'>,
  systemLabels: readonly SystemLabelDto[] = [],
): string {
  const on = new Set(system.systemLabelIds);
  const names = systemLabels.filter((l) => on.has(l.id)).map((l) => l.name);
  if (system.customLabel) names.push(system.customLabel);
  return names.join(' ');
}

/** `{n}` text: `3`, and `{N}`: `03`. */
function numberVars(n: number | undefined): Pick<BookmarkVars, 'n' | 'N'> {
  return n === undefined ? { n: '', N: '' } : { n: String(n), N: String(n).padStart(2, '0') };
}

/**
 * Walks the chain from its roots (see `chainTree`) and gives every reachable system the
 * variables of the wormhole that leads into it from its parent. Roots have no parent: their
 * variables are empty but `destClass` and `tempName`.
 */
export function bookmarkChain(input: BookmarkChainInput): Map<number, BookmarkVars & { root: boolean }> {
  const byId = new Map(input.systems.map((s) => [s.solarSystemId, s]));
  const { roots, steps } = chainTree(input.systems, input.connections);
  const sigByConnection = new Map<string, SignatureDto[]>();
  for (const s of input.signatures) {
    if (s.connectionId)
      sigByConnection.set(s.connectionId, [...(sigByConnection.get(s.connectionId) ?? []), s]);
  }
  const sigOf = (step: ChainStep) =>
    (sigByConnection.get(step.connection.id) ?? []).find((s) => s.solarSystemId === step.parent);

  // `{n}`: the shared number while it was given for this parent, or the viewer's own order.
  const numberOf = new Map<string, number>();
  if (input.order) {
    const byParent = new Map<number, BookmarkSibling[]>();
    for (const step of steps) {
      if (!numbersBookmark(step.connection)) continue;
      const c = step.connection;
      byParent.set(step.parent, [
        ...(byParent.get(step.parent) ?? []),
        {
          connectionId: c.id,
          createdAt: c.createdAt,
          signature: sigOf(step)?.eveId ?? null,
          destClass: input.classOf(step.child),
          number: c.bookmarkParent === step.parent ? (c.bookmarkNumber ?? null) : null,
        },
      ]);
    }
    for (const siblings of byParent.values()) {
      siblings.sort(compareBookmarkSiblings(input.order));
      siblings.forEach((s, i) => numberOf.set(s.connectionId, i + 1));
    }
  } else {
    for (const { connection: c, parent } of steps) {
      if (numbersBookmark(c) && c.bookmarkNumber && c.bookmarkParent === parent)
        numberOf.set(c.id, c.bookmarkNumber);
    }
  }

  const result = new Map<number, BookmarkVars & { root: boolean }>();
  const base = (s: MapSystemDto): BookmarkVars => ({
    sig: '',
    sig3: '',
    chainIndex: '',
    n: '',
    N: '',
    destClass: input.classOf(s.solarSystemId),
    type: '',
    size: '',
    mass: '',
    eol: '',
    tempName: s.temporaryName ?? '',
    labels: systemLabelsText(s, input.systemLabels),
  });
  for (const root of roots) result.set(root, { ...base(byId.get(root)!), chainIndex: '0', root: true });
  const letters = new Map<number, number>();
  for (const step of steps) {
    const c = step.connection;
    const sig = sigOf(step);
    const sibling = letters.get(step.parent) ?? 0;
    letters.set(step.parent, sibling + 1);
    result.set(step.child, {
      ...base(byId.get(step.child)!),
      sig: sig?.eveId ?? '',
      sig3: sig?.eveId.slice(0, 3) ?? '',
      chainIndex: `${step.depth}${siblingLetter(sibling)}`,
      ...numberVars(numberOf.get(c.id)),
      type: sig?.type ?? '',
      size: SIZE_TEXT[c.shipSize],
      mass: c.massStatus === 'critical' ? 'crit' : c.massStatus === 'reduced' ? 'reduced' : '',
      eol: c.timeStatus === 'eol' ? 'EOL' : '',
      root: false,
    });
  }
  return result;
}

/**
 * The label shown above a system. A temporary name wins unless the template places it itself;
 * roots (home) show only a temporary name; nothing to show is null.
 */
export function bookmarkLabel(template: string, vars: BookmarkVars & { root: boolean }): string | null {
  const used = bookmarkTemplateVariables(template);
  if (vars.tempName && !used.includes('tempName')) return vars.tempName;
  if (vars.root) return vars.tempName || null;
  // Without the signature of the hole there is nothing to bookmark yet; nor without its number
  // (a stargate, or a wormhole the server has not numbered yet).
  const needsSig = used.includes('sig') || used.includes('sig3');
  if (needsSig && !vars.sig) return vars.tempName || null;
  const needsNumber = used.includes('n') || used.includes('N');
  if (needsNumber && !vars.n) return vars.tempName || null;
  const label = renderBookmarkTemplate(template, vars);
  return label || null;
}

/** Sample variables for previews in the settings. */
export const BOOKMARK_PREVIEW_VARS: BookmarkVars & { root: boolean } = {
  sig: 'ABC-123',
  sig3: 'ABC',
  chainIndex: '1a',
  n: '1',
  N: '01',
  destClass: 'C3',
  type: 'O477',
  size: 'L',
  mass: '',
  eol: '',
  tempName: '',
  labels: 'WH1',
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
  /**
   * This account's own order for `{n}`; null or absent follows the map's numbering. Numbers in
   * another order than the map's are counted on this screen only, so they may differ from what
   * the rest of the fleet sees.
   */
  bookmarkOrder: BookmarkOrder.nullable().optional(),
  updatedAt: z.number().int().nonnegative(),
});
export type MapPreferencesDto = z.infer<typeof MapPreferencesDto>;

export const UpdateMapPreferencesRequest = z
  .object({
    viewport: MapViewport.nullable(),
    bookmarkTemplate: BookmarkTemplate.nullable(),
    bookmarkOrder: BookmarkOrder.nullable(),
  })
  .partial();
export type UpdateMapPreferencesRequest = z.infer<typeof UpdateMapPreferencesRequest>;

/** PUT /api/maps/:mapId/bookmark-template (manager+): the map's default; null resets to `{sig}`. */
export const SetBookmarkTemplateRequest = z.object({ template: BookmarkTemplate.nullable() });
export type SetBookmarkTemplateRequest = z.infer<typeof SetBookmarkTemplateRequest>;

/** PUT /api/maps/:mapId/bookmark-numbering (manager+): the map's numbering; null resets it. */
export const SetBookmarkNumberingRequest = z.object({ numbering: BookmarkNumbering.nullable() });
export type SetBookmarkNumberingRequest = z.infer<typeof SetBookmarkNumberingRequest>;

/**
 * POST /api/maps/:mapId/bookmark-numbers/renumber (member+): numbers the wormholes out of
 * `parent` (every system when absent) 1, 2, 3 again in the map's order, closing the gaps.
 */
export const RenumberBookmarksRequest = z.object({ parent: EveId.optional() });
export type RenumberBookmarksRequest = z.infer<typeof RenumberBookmarksRequest>;

/**
 * PUT /api/maps/:mapId/connections/:connectionId/bookmark-number (member+): gives a wormhole its
 * number among the wormholes out of its parent; a sibling holding that number takes the old one.
 */
export const SetBookmarkNumberRequest = z.object({ number: z.number().int().min(1).max(99) });
export type SetBookmarkNumberRequest = z.infer<typeof SetBookmarkNumberRequest>;
