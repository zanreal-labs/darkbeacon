import { ForbiddenError, hasMapRole, type Actor } from '@darkbeacon/core';
import type {
  MapRole,
  PasteSystemsRequest,
  PasteSystemsResultDto,
  UpdateConnectionRequest,
  UpdateSystemRequest,
} from '@darkbeacon/shared';
import type { ChainMap } from '../domain/map.js';
import { changes } from '../domain/rules.js';
import { MappingUseCases } from './base.js';
import { ConnectionUseCases } from './connections.js';
import { SystemUseCases } from './systems.js';

/** Who may copy and paste systems when the map does not say: viewers copy, members paste. */
export const DEFAULT_CLIPBOARD_ROLES: { copy: MapRole; paste: MapRole } = { copy: 'viewer', paste: 'member' };

const ROLE_WORDS: Record<MapRole, string> = {
  blocked: 'nobody',
  viewer: 'viewers',
  member: 'members',
  manager: 'managers',
  admin: 'admins',
};

/**
 * Copy and paste of systems between maps (Wanderer's, keeping attributes as the fork does). The
 * copy is the browser's (it holds what the viewer sees); pasting places the systems with their
 * status, names, notes, Labels and Tags (by name) and connects them with their flags, in one
 * transaction and through the same use cases as single changes.
 */
export class ClipboardUseCases extends MappingUseCases {
  async paste(
    actor: Actor | null,
    mapId: string,
    request: PasteSystemsRequest,
  ): Promise<PasteSystemsResultDto> {
    const who = await this.authorizeEdit(actor, mapId);
    const map = await this.ports.maps.findById(mapId);
    const role = await this.ports.access.roleOf(who, mapId);
    const needed = map?.settings.clipboard?.paste ?? DEFAULT_CLIPBOARD_ROLES.paste;
    if (!hasMapRole(role, needed === 'blocked' || needed === 'viewer' ? 'member' : needed))
      throw new ForbiddenError(`Only ${ROLE_WORDS[needed]} and up paste systems on this map`);
    const manager = hasMapRole(role, 'manager');

    const { clipboard, at } = request;
    const labelIds = new Map(map?.systemLabels.map((l) => [l.name.toLowerCase(), l.id]));
    const tagIds = new Map(map?.labels.map((l) => [l.name.toLowerCase(), l.id]));
    const missing = new Set<string>();
    const pick = (names: readonly string[], ids: Map<string, string>) =>
      names.flatMap((name) => {
        const id = ids.get(name.toLowerCase());
        if (!id) missing.add(name);
        return id ? [id] : [];
      });
    const left = Math.min(...clipboard.systems.map((s) => s.position.x));
    const top = Math.min(...clipboard.systems.map((s) => s.position.y));

    const systems = new SystemUseCases(this.ports);
    const connections = new ConnectionUseCases(this.ports);
    return this.ports.uow.transaction(async () => {
      const result: PasteSystemsResultDto = { added: [], existing: [], connections: 0, missingLabels: [] };
      const onMap = new Set<number>();
      for (const copied of clipboard.systems) {
        if (!this.ports.universe.getSystem(copied.solarSystemId)) continue;
        onMap.add(copied.solarSystemId);
        if ((await this.ports.systems.find(mapId, copied.solarSystemId))?.visible) {
          result.existing.push(copied.solarSystemId);
          continue;
        }
        const position = {
          x: Math.round(at.x + copied.position.x - left),
          y: Math.round(at.y + copied.position.y - top),
        };
        const placed = await systems.add(who, mapId, { solarSystemId: copied.solarSystemId, position });
        const patch: UpdateSystemRequest = {
          status: copied.status,
          customName: copied.customName,
          temporaryName: copied.temporaryName,
          tag: copied.tag,
          description: copied.description,
          customLabel: copied.customLabel,
          systemLabelIds: pick(copied.systemLabels, labelIds),
          labelIds: pick(copied.tags, tagIds),
          // Locking is for managers here too.
          ...(manager && copied.locked ? { locked: true } : {}),
        };
        if (changes(placed, patch)) await systems.update(who, mapId, copied.solarSystemId, patch);
        result.added.push(copied.solarSystemId);
      }
      for (const { source, target, type, ...flags } of clipboard.connections) {
        if (!onMap.has(source) || !onMap.has(target) || source === target) continue;
        const known = await this.ports.connections.findBetween(mapId, source, target);
        if (known) continue;
        const linked = await connections.add(who, mapId, { source, target, type });
        const patch: Omit<UpdateConnectionRequest, 'lifetime'> = {
          timeStatus: flags.timeStatus,
          massStatus: flags.massStatus,
          shipSize: flags.shipSize,
          massSaved: flags.massSaved,
          dangerous: flags.dangerous,
          bubbled: flags.bubbled,
          ...(flags.note ? { note: flags.note } : {}),
        };
        if (changes(linked, patch)) await connections.update(who, mapId, linked.id, patch);
        result.connections += 1;
      }
      result.missingLabels = [...missing].sort();
      return result;
    });
  }

  /** Who may copy systems off the map and paste onto it (manager+). */
  async setRoles(
    actor: Actor | null,
    mapId: string,
    roles: { copy: MapRole; paste: MapRole },
  ): Promise<ChainMap> {
    const who = await this.authorize(actor, mapId, 'manager');
    return this.write(who, mapId, async (events) => {
      const current = (await this.ports.maps.findById(mapId))!;
      const isDefault =
        roles.copy === DEFAULT_CLIPBOARD_ROLES.copy && roles.paste === DEFAULT_CLIPBOARD_ROLES.paste;
      const { clipboard: _old, ...settings } = current.settings;
      const next: ChainMap = {
        ...current,
        settings: isDefault ? settings : { ...settings, clipboard: roles },
      };
      if (!changes(current, next)) return current;
      next.updatedAt = this.ports.clock.now();
      await this.ports.maps.update(next);
      events.add('map.settings_changed', next, current);
      return next;
    });
  }
}
