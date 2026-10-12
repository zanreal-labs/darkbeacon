import { requireAccount, requireMapRole, type Actor, type Clock, type MapAccess } from '@darkbeacon/core';
import type { MapPreferencesDto, UpdateMapPreferencesRequest } from '@darkbeacon/shared';
import type { MapPreferences } from '../domain/map.js';
import type { MapPreferenceRepository } from '../ports/index.js';

export interface MapPreferencePorts {
  preferences: MapPreferenceRepository;
  access: MapAccess;
  clock: Clock;
}

const toDto = ({ viewport, bookmarkTemplate, updatedAt }: MapPreferences): MapPreferencesDto => ({
  viewport,
  bookmarkTemplate,
  updatedAt,
});

/**
 * An account's own view of a map: where it last left the canvas and its bookmark label template.
 * Any role that can see the map may keep one; it is private, so no events are published.
 */
export class MapPreferenceUseCases {
  constructor(private readonly ports: MapPreferencePorts) {}

  async get(actor: Actor | null, mapId: string): Promise<MapPreferencesDto> {
    const account = requireAccount(actor);
    await requireMapRole(this.ports.access, account, mapId, 'viewer');
    const stored = await this.ports.preferences.find(mapId, account.id);
    return stored ? toDto(stored) : { viewport: null, bookmarkTemplate: null, updatedAt: 0 };
  }

  async update(
    actor: Actor | null,
    mapId: string,
    request: UpdateMapPreferencesRequest,
  ): Promise<MapPreferencesDto> {
    const account = requireAccount(actor);
    await requireMapRole(this.ports.access, account, mapId, 'viewer');
    const current = await this.ports.preferences.find(mapId, account.id);
    const next: MapPreferences = {
      mapId,
      accountId: account.id,
      viewport: request.viewport !== undefined ? request.viewport : (current?.viewport ?? null),
      bookmarkTemplate:
        request.bookmarkTemplate !== undefined
          ? request.bookmarkTemplate
          : (current?.bookmarkTemplate ?? null),
      updatedAt: this.ports.clock.now(),
    };
    await this.ports.preferences.save(next);
    return toDto(next);
  }
}
