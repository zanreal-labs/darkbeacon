import {
  SYSTEMS_CLIPBOARD_KIND,
  SystemsClipboard,
  type ConnectionDto,
  type LabelDto,
  type MapRole,
  type MapSystemDto,
  type SystemLabelDto,
  type SystemsClipboardInput,
} from '@darkbeacon/shared';

/*
 * Copied systems travel as JSON text on the clipboard, so they paste into another tab, another
 * map or another Darkbeacon. Labels and Tags go by name; the target map matches them by name.
 */

/** What Ctrl+C on these systems puts on the clipboard: them, and the connections between them. */
export function copiedSystems(
  from: { id: string; name: string },
  state: { systems: ReadonlyMap<number, MapSystemDto>; connections: ReadonlyMap<string, ConnectionDto> },
  ids: readonly number[],
  lists: { systemLabels: readonly SystemLabelDto[]; tags: readonly LabelDto[] },
): SystemsClipboardInput | null {
  const picked = new Set(ids);
  const labelName = new Map(lists.systemLabels.map((l) => [l.id, l.name]));
  const tagName = new Map(lists.tags.map((t) => [t.id, t.name]));
  const systems = ids.flatMap((id) => {
    const s = state.systems.get(id);
    if (!s) return [];
    return [
      {
        solarSystemId: s.solarSystemId,
        position: s.position,
        status: s.status,
        customName: s.customName,
        temporaryName: s.temporaryName,
        tag: s.tag,
        description: s.description,
        customLabel: s.customLabel,
        systemLabels: s.systemLabelIds.flatMap((l) => labelName.get(l) ?? []),
        tags: s.labelIds.flatMap((t) => tagName.get(t) ?? []),
        locked: s.locked,
      },
    ];
  });
  if (systems.length === 0) return null;
  const connections = [...state.connections.values()]
    .filter((c) => picked.has(c.source) && picked.has(c.target) && !c.id.startsWith('pending:'))
    .map((c) => ({
      source: c.source,
      target: c.target,
      type: c.type,
      timeStatus: c.timeStatus,
      massStatus: c.massStatus,
      shipSize: c.shipSize,
      massSaved: c.massSaved,
      dangerous: c.dangerous,
      bubbled: c.bubbled,
      note: c.note ?? '',
    }));
  return {
    kind: SYSTEMS_CLIPBOARD_KIND,
    v: 1,
    from: { mapId: from.id, name: from.name.slice(0, 64) },
    systems,
    connections,
  };
}

/** Copied systems in clipboard text, or null for any other text. */
export function readCopiedSystems(text: string): SystemsClipboard | null {
  if (!text.includes(SYSTEMS_CLIPBOARD_KIND)) return null;
  try {
    const parsed = SystemsClipboard.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const RANK: Record<MapRole, number> = { blocked: -1, viewer: 0, member: 1, manager: 2, admin: 3 };

/** Whether `role` reaches `needed` (the map's clipboard roles). */
export function roleReaches(role: MapRole | null | undefined, needed: MapRole): boolean {
  return role !== null && role !== undefined && RANK[role] >= Math.max(0, RANK[needed]);
}
