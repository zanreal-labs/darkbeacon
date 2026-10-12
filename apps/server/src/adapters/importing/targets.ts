import type { AccessRules } from '@darkbeacon/access';
import type { Actor, MapAccess } from '@darkbeacon/core';
import type { EveDirectoryService } from '@darkbeacon/identity';
import type {
  AccessTarget,
  ChainTarget,
  EveName,
  EveNames,
  SystemNames,
  TargetMap,
  WebhookTarget,
} from '@darkbeacon/importing';
import type {
  ChainImportUseCases,
  ConnectionUseCases,
  MapUseCases,
  SignatureUseCases,
  SystemUseCases,
  UniverseCatalog,
} from '@darkbeacon/mapping';
import type { WebhookAdmin } from '@darkbeacon/notifications';
import type { HubAdmin, RouteQueries } from '@darkbeacon/routing';
import type { MapDto } from '@darkbeacon/shared';

export interface MappingUseCaseSet {
  maps: MapUseCases;
  systems: SystemUseCases;
  connections: ConnectionUseCases;
  signatures: SignatureUseCases;
  imports: ChainImportUseCases;
}

const target = (map: MapDto): TargetMap => ({
  id: map.id,
  slug: map.slug,
  name: map.name,
  description: map.description ?? '',
  labels: map.labels,
  settings: map.settings,
  kind: map.kind === 'composite' ? 'composite' : 'map',
});

/**
 * The importing module's view of a map, answered by the mapping and routing use cases: every
 * call is authorised for the importing account and every change is an event, like an edit.
 */
export class MappingChainTarget implements ChainTarget {
  constructor(
    private readonly mapping: MappingUseCaseSet,
    private readonly access: MapAccess,
    private readonly hubAdmin: HubAdmin,
    private readonly routes: RouteQueries,
  ) {}

  async createMap(actor: Actor, request: { name: string; slug?: string }): Promise<TargetMap> {
    return target(await this.mapping.maps.create(actor, request));
  }

  async map(actor: Actor, mapId: string): Promise<TargetMap> {
    return target(await this.mapping.maps.get(actor, mapId));
  }

  roleOf(actor: Actor, mapId: string) {
    return this.access.roleOf(actor, mapId);
  }

  systems(actor: Actor, mapId: string) {
    return this.mapping.imports.systems(actor, mapId);
  }

  connections(actor: Actor, mapId: string) {
    return this.mapping.imports.connections(actor, mapId);
  }

  signatures(actor: Actor, mapId: string) {
    return this.mapping.imports.signatures(actor, mapId);
  }

  putSystem(...args: Parameters<ChainTarget['putSystem']>) {
    return this.mapping.imports.putSystem(...args);
  }

  putConnection(...args: Parameters<ChainTarget['putConnection']>) {
    return this.mapping.imports.putConnection(...args);
  }

  putSignature(...args: Parameters<ChainTarget['putSignature']>) {
    return this.mapping.imports.putSignature(...args);
  }

  putPassage(...args: Parameters<ChainTarget['putPassage']>) {
    return this.mapping.imports.putPassage(...args);
  }

  ensureLabels(...args: Parameters<ChainTarget['ensureLabels']>) {
    return this.mapping.imports.ensureLabels(...args);
  }

  async setScopes(actor: Actor, mapId: string, scopes: MapDto['settings']['scopes']): Promise<void> {
    await this.mapping.maps.update(actor, mapId, { settings: { scopes } });
  }

  async setDescription(actor: Actor, mapId: string, description: string): Promise<void> {
    await this.mapping.maps.update(actor, mapId, { description });
  }

  hideSystem(actor: Actor, mapId: string, solarSystemId: number): Promise<void> {
    return this.mapping.systems.remove(actor, mapId, solarSystemId);
  }

  removeConnection(actor: Actor, mapId: string, connectionId: string): Promise<void> {
    return this.mapping.connections.remove(actor, mapId, connectionId);
  }

  removeSignature(actor: Actor, mapId: string, signatureId: string): Promise<void> {
    return this.mapping.signatures.remove(actor, mapId, signatureId);
  }

  async hubs(actor: Actor, mapId: string): Promise<number[]> {
    return (await this.routes.hubs(actor, mapId)).map.map((h) => h.solarSystemId);
  }

  async setHubs(actor: Actor, mapId: string, solarSystemIds: number[]): Promise<void> {
    await this.hubAdmin.setMapHubs(actor, mapId, solarSystemIds);
  }
}

/** The map's webhooks through the notifications module's use cases (map admins). */
export class MapWebhooksTarget implements WebhookTarget {
  constructor(private readonly webhooks: WebhookAdmin) {}

  async ids(actor: Actor, mapId: string): Promise<string[]> {
    return (await this.webhooks.list(actor, mapId)).map((w) => w.id);
  }

  async addDisabled(
    actor: Actor,
    mapId: string,
    webhook: { url: string; events: string[] },
  ): Promise<string> {
    return (await this.webhooks.create(actor, mapId, webhook, { enabled: false })).id;
  }
}

/** Access rules through the access module's use cases (map admins). */
export class AccessRulesTarget implements AccessTarget {
  constructor(private readonly rules: AccessRules) {}

  list(actor: Actor, mapId: string) {
    return this.rules.list(actor, mapId);
  }

  add(actor: Actor, mapId: string, rule: Parameters<AccessTarget['add']>[2]) {
    return this.rules.add(actor, mapId, { ...rule, guildId: null });
  }

  remove(actor: Actor, mapId: string, ruleId: string) {
    return this.rules.remove(actor, mapId, ruleId);
  }
}

/** EVE names from identity's ESI directory (cached there); a failing ESI gives no names. */
export class EveDirectoryNames implements EveNames {
  constructor(private readonly directory: EveDirectoryService) {}

  async describe(ids: readonly number[]): Promise<Map<number, EveName>> {
    const out = new Map<number, EveName>();
    const entities = await this.directory.entities(ids).catch(() => []);
    for (const e of entities) out.set(e.id, { name: e.name, category: e.category, ticker: e.ticker });
    return out;
  }
}

export class CatalogSystemNames implements SystemNames {
  constructor(private readonly universe: UniverseCatalog) {}

  systemName(solarSystemId: number): string | null {
    return this.universe.getSystem(solarSystemId)?.name ?? null;
  }
}
