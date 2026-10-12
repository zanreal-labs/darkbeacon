import type { UniverseCatalog } from '@darkbeacon/mapping';
import {
  WORMHOLE_DESTINATION_LABEL,
  WORMHOLE_EFFECTS,
  classLabel,
  type CharacterPresenceDto,
  type ConnectionDto,
  type ConnectionIntelDto,
  type MapExitDto,
  type MapSystemDto,
  type RouteDto,
  type SignatureDto,
  type UniverseSystemDto,
} from '@darkbeacon/shared';

/**
 * Compact, token-light text for language models: one line per thing, short labels, no ids an
 * agent cannot use (system names stand in for system ids; connection and signature ids are kept
 * short where tools need them back).
 */

export function securityLabel(system: UniverseSystemDto | null | undefined): string {
  if (!system) return '?';
  const label = classLabel(system.whClass);
  if (system.whClass !== null && system.whClass !== undefined && system.whClass <= 6) return label ?? '?';
  const sec =
    system.security >= 0 && system.security < 0.05 && system.security > 0
      ? 0.1
      : Math.round(system.security * 10) / 10;
  return `${label ?? '?'} ${sec.toFixed(1)}`;
}

export function staticsLabel(catalog: UniverseCatalog, system: UniverseSystemDto | null | undefined): string {
  if (!system || system.statics.length === 0) return '';
  return system.statics
    .map((code) => {
      const type = catalog.wormholeType(code);
      return type?.destination ? `${code}>${WORMHOLE_DESTINATION_LABEL[type.destination]}` : code;
    })
    .join(' ');
}

export function systemName(
  catalog: UniverseCatalog,
  id: number,
  onMap?: Pick<MapSystemDto, 'customName'> | null,
): string {
  const name = catalog.getSystem(id)?.name ?? String(id);
  return onMap?.customName ? `${onMap.customName} (${name})` : name;
}

export function systemLine(catalog: UniverseCatalog, system: MapSystemDto, extras: string[] = []): string {
  const info = catalog.getSystem(system.solarSystemId);
  const parts = [systemName(catalog, system.solarSystemId, system), `[${securityLabel(info)}]`];
  const statics = staticsLabel(catalog, info);
  if (statics) parts.push(`statics ${statics}`);
  if (info?.effect) parts.push(`effect ${WORMHOLE_EFFECTS[info.effect].name}`);
  if (system.status !== 'unknown') parts.push(`status ${system.status}`);
  if (system.tag) parts.push(`tag ${system.tag}`);
  if (system.temporaryName) parts.push(`bookmark ${system.temporaryName}`);
  if (system.locked) parts.push('locked');
  if (system.description) parts.push(`note "${oneLine(system.description, 120)}"`);
  return [...parts, ...extras].join(' | ');
}

export function connectionLine(catalog: UniverseCatalog, c: ConnectionDto, withStatus: boolean): string {
  const ends = `${systemName(catalog, c.source)} <-> ${systemName(catalog, c.target)}`;
  if (c.type !== 'wormhole') return [ends, c.type, ...connectionTail(c)].join(' | ');
  const parts = [ends, 'wh'];
  if (withStatus) {
    parts.push(`mass ${c.massStatus}`, c.timeStatus === 'eol' ? 'EOL' : 'time ok', `size ${c.shipSize}`);
    if (c.massSaved) parts.push('mass saved');
    if (c.lifetime) parts.push(`marked <${c.lifetime.mark} left at ${new Date(c.lifetime.at).toISOString()}`);
  }
  if (c.dangerous) parts.push('DANGER');
  if (c.bubbled !== 'none') parts.push(`bubbled ${c.bubbled}`);
  return [...parts, ...connectionTail(c)].join(' | ');
}

function connectionTail(c: ConnectionDto): string[] {
  const parts: string[] = [];
  if (c.locked) parts.push('locked');
  if (c.note) parts.push(`note "${oneLine(c.note, 120)}"`);
  parts.push(`id ${short(c.id)}`);
  return parts;
}

export function intelLine(c: ConnectionIntelDto): string {
  const parts = [`${c.source.name} <-> ${c.target.name}`, c.type];
  if (c.wormholeType) parts.push(`${c.wormholeType}${c.wormholeTypeFrom === 'static' ? '?' : ''}`);
  parts.push(`urgency ${c.urgency}`, `mass ${c.massStatus}`);
  if (c.mass.remainingFraction !== null) parts.push(`~${Math.round(c.mass.remainingFraction * 100)}% left`);
  if (c.timeStatus === 'eol') parts.push('EOL');
  if (c.time.remainingMs !== null) parts.push(`<=${hours(c.time.remainingMs)} left`);
  parts.push(`size ${c.shipSize}`);
  if (c.fits.length) parts.push(`fits ${c.fits.join(',')}`);
  if (c.dangerous) parts.push('DANGER');
  if (c.bubbled !== 'none') parts.push(`bubbled ${c.bubbled}`);
  parts.push(`id ${short(c.connectionId)}`);
  return parts.join(' | ');
}

export function exitLine(exit: MapExitDto): string {
  if (exit.kind === 'static') {
    const statics = exit.statics
      .map((s) => `${s.code}>${WORMHOLE_DESTINATION_LABEL[s.destination]}`)
      .join(' ');
    return `${exit.name} [${exit.classLabel ?? '?'}] unopened static ${statics}`;
  }
  const near = exit.nearest
    ? `nearest ${exit.nearest.name} ${exit.nearest.jumps ?? '?'}j`
    : 'no hub reachable';
  const hubs = exit.hubs
    .slice(0, 5)
    .map((h) => `${h.name} ${h.jumps ?? '-'}j`)
    .join(', ');
  return `${exit.name} [${exit.classLabel ?? exit.security.toFixed(1)}] ${near}${hubs ? ` (${hubs})` : ''}`;
}

export function routeText(route: RouteDto): string {
  if (route.jumps === null) return `No ${route.mode} route found.`;
  const steps = route.steps.map((s) =>
    s.via === 'start' ? s.name : `${s.via === 'gate' ? '-' : s.via === 'wormhole' ? '~' : '='}> ${s.name}`,
  );
  return `${route.jumps} jumps (${route.mode}): ${steps.join(' ')}\nLegend: -> gate, ~> wormhole, => bridge.`;
}

export function signatureLine(s: SignatureDto): string {
  const parts = [
    s.eveId,
    s.kind && s.kind !== 'signature' ? s.kind : null,
    s.custom ? 'custom' : null,
    s.group,
  ].filter((p): p is string => p !== null);
  if (s.type) parts.push(s.type);
  if (s.name) parts.push(s.name);
  if (s.connectionId) parts.push(`links ${short(s.connectionId)}`);
  if (s.description) parts.push(`"${oneLine(s.description, 80)}"`);
  parts.push(`id ${short(s.id)}`);
  return parts.join(' | ');
}

export function characterLine(catalog: UniverseCatalog, c: CharacterPresenceDto): string {
  const where = c.solarSystemId ? systemName(catalog, c.solarSystemId) : 'unknown';
  return `${c.name} in ${where}${c.online ? '' : ' (offline)'}${c.shipName ? ` ship "${c.shipName}"` : ''}`;
}

/**
 * The last 8 characters of an id (the random part of a v7 id): enough to tell things apart; tools
 * take it back. Ids on maps that merge others (`c:<low>-<high>`, `s:<system>:<code>`) are made from
 * system ids, so their ends repeat; they are given whole.
 */
export function short(id: string): string {
  return id.length > 8 && !id.includes(':') ? id.slice(-8) : id;
}

function hours(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${m}m`;
}

export function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Opaque cursors over a list: the offset, base64url. */
export function page<T>(
  items: readonly T[],
  cursor: string | undefined,
  limit: number,
): { items: T[]; next: string | null } {
  const offset = cursor ? Math.max(0, Number(Buffer.from(cursor, 'base64url').toString()) || 0) : 0;
  const slice = items.slice(offset, offset + limit);
  const end = offset + slice.length;
  return { items: slice, next: end < items.length ? Buffer.from(String(end)).toString('base64url') : null };
}
