// Runs from DATA_DIR/plugins, where no packages are installed: SDK imports are types only.
import type {
  ConnectionDto,
  DomainEvent,
  MapSystemDto,
  Notification,
  PluginContext,
  ServerPlugin,
  SignatureDto,
} from '@darkbeacon/plugin-sdk';

type Ports = 'maps' | 'universe';
type Ctx = PluginContext<Ports>;

export interface DiscordSettings {
  webhookUrl?: string;
  events: string[];
  username: string;
}

const SUBSCRIPTIONS = ['system.*', 'connection.*', 'signature.*', 'ping.*'];

/** Same rule as the manifest: exact type, `prefix.*` or `*`. */
export function wants(patterns: readonly string[], type: string): boolean {
  return patterns.some(
    (p) => p === '*' || p === type || (p.endsWith('.*') && type.startsWith(p.slice(0, -1))),
  );
}

export async function postToDiscord(
  url: string,
  username: string,
  notification: Notification,
  send: typeof fetch = fetch,
): Promise<void> {
  const embed = {
    title: notification.title.slice(0, 256),
    description: notification.body.slice(0, 4000),
    ...(notification.url ? { url: notification.url } : {}),
    timestamp: new Date(notification.event?.occurredAt ?? Date.now()).toISOString(),
  };
  const response = await send(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, embeds: [embed], allowed_mentions: { parse: [] } }),
  });
  // Rate limited: drop this message instead of counting it as a plugin failure.
  if (response.status === 429) return;
  if (!response.ok) throw new Error(`Discord answered ${response.status}`);
}

/** A one-line title and body for an event, with system names when universe data is there. */
export function describe(event: DomainEvent, mapName: string, systemName: (id: number) => string) {
  const d = event.data as Record<string, unknown>;
  const text = (): string | null => {
    switch (event.type) {
      case 'system.added':
        return `${systemName((d as MapSystemDto).solarSystemId)} was added`;
      case 'system.removed':
        return `${systemName(d.solarSystemId as number)} was removed`;
      case 'system.updated': {
        const s = d as MapSystemDto;
        return `${systemName(s.solarSystemId)} was updated (status ${s.status})`;
      }
      case 'connection.added':
      case 'connection.updated': {
        const c = d as ConnectionDto;
        const verb = event.type === 'connection.added' ? 'New connection' : 'Connection updated';
        return `${verb}: ${systemName(c.source)} - ${systemName(c.target)} (${c.timeStatus}, mass ${c.massStatus})`;
      }
      case 'connection.removed':
        return 'A connection was removed';
      case 'signature.added':
      case 'signature.updated': {
        const s = d as SignatureDto;
        const what = [s.group, s.type, s.name].filter(Boolean).join(' ');
        return `Signature ${s.eveId} in ${systemName(s.solarSystemId)}: ${what}`;
      }
      case 'ping.created':
        return `Ping in ${systemName(d.solarSystemId as number)}: ${String(d.message ?? '')}`;
      default:
        return null;
    }
  };
  const body = text();
  return { title: `${mapName}: ${event.type}`, body: body ?? `${event.type} on ${mapName}` };
}

async function onEvent(ctx: Ctx, event: DomainEvent): Promise<void> {
  const mapId = event.stream.startsWith('map:') ? event.stream.slice(4) : null;
  if (!mapId) return;
  const settings = await ctx.settings.forMap<DiscordSettings>(mapId);
  if (!settings.webhookUrl || !wants(settings.events, event.type)) return;
  const map = await ctx.ports.maps.getMap(mapId);
  const systemName = (id: number) => {
    try {
      return ctx.ports.universe.getSystem(id)?.name ?? `#${id}`;
    } catch {
      return `#${id}`;
    }
  };
  const { title, body } = describe(event, map?.name ?? 'Map', systemName);
  await postToDiscord(settings.webhookUrl, settings.username, { mapId, title, body, event });
}

const plugin: ServerPlugin<Ports> = {
  register(ctx) {
    for (const type of SUBSCRIPTIONS) ctx.on(type, (event) => onEvent(ctx, event));
    // Notifications other plugins send through the core notifier also go to Discord.
    ctx.provide('notifier', {
      id: 'discord',
      async send(notification) {
        const settings = notification.mapId
          ? await ctx.settings.forMap<DiscordSettings>(notification.mapId)
          : await ctx.settings.get<DiscordSettings>();
        if (settings.webhookUrl) await postToDiscord(settings.webhookUrl, settings.username, notification);
      },
    });
    ctx.logger.info('ready');
  },
};

export default plugin;
