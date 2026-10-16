'use client';

import { memo, type CSSProperties, type MouseEvent } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import {
  WORMHOLE_DESTINATION_LABEL,
  WORMHOLE_EFFECTS,
  wormholeDestination,
  type LabelDto,
  type MapSystemDto,
  standingTone,
  statusFromStanding,
  type SystemIntelDto,
  type SystemLabelDto,
  type UniverseSystemDto,
  type WormholeTypeDto,
} from '@darkbeacon/shared';
import { cssVar } from '@darkbeacon/theme-sdk';
import { Lock, MapPin, MessageSquareText, Users } from 'lucide-react';
import { staticFacts, useWormholeTypes } from '../lib/wormholes';
import { PluginSlot } from '../plugins/PluginSlot';
import { Tooltip, useToast } from '../ui';
import {
  classPill,
  nearestHubTitle,
  ROUTE_SPACE_COLOR,
  STATUS_LABEL,
  statusTint,
  type NearestHub,
} from './nodeFacts';
import { EffectDot, NodeKills, NodeSovereignty, ShatteredMark } from './NodeIntel';
import { destinationToken } from './WormholeFacts';
import styles from './SystemNode.module.css';

export interface SystemNodeData extends Record<string, unknown> {
  mapId: string;
  system: MapSystemDto;
  /** Static data; undefined while loading. */
  info: UniverseSystemDto | undefined;
  /** The system's Labels (WH1...), resolved from the map's list in its order (first above the node). */
  systemLabels: SystemLabelDto[];
  /** The system's Tags, resolved from the map's list (last above the node). */
  tags: LabelDto[];
  /** Tracked characters currently in the system. */
  characters: number;
  /** Bookmark label above the system (see `bookmarkLabel` in shared); null for none. */
  bookmark?: string | null;
  /** For an exit to known space: the nearest hub, from the routing API (shown below the node). */
  hub?: NearestHub | null;
  /** One of the viewer's own characters is here: the pilot count is in the accent colour. */
  mine?: boolean;
  /** Sovereignty and kills of the last hour (system intel); undefined while loading. */
  intel?: SystemIntelDto;
  /**
   * How the viewer stands towards the holder (contacts, -10..+10): colours the sovereignty ticker,
   * and an unmarked system takes its status from it.
   */
  standing?: number | null;
  /** A kill just came in: the node rings softly for a moment. */
  pulse?: boolean;
  /** The viewer reads the map with an account (not a public view): killmail lists, wormhole facts. */
  withAccount?: boolean;
  /** The pilots counted on the node, listed when hovering the count (mine first). */
  pilots?: ReadonlyArray<{ id: number; name: string; ship: string | null; mine: boolean }>;
  /** A route hub of the map or of the viewer: a small pin in the corner. */
  routeHub?: 'map' | 'personal' | null;
}

export type SystemNodeType = Node<SystemNodeData, 'system'>;

const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left];

/** What the node calls the system: its custom name, else a temporary name, else the real name. */
export function systemDisplayName(system: MapSystemDto, info: UniverseSystemDto | undefined): string {
  return system.customName || system.temporaryName || info?.name || String(system.solarSystemId);
}

/**
 * The name on the node: a custom name, else the real one. A temporary name is shown as the
 * bookmark label above the node instead (see `bookmarkLabel`).
 */
export function nodeName(system: MapSystemDto, info: UniverseSystemDto | undefined): string {
  return system.customName || info?.name || String(system.solarSystemId);
}

/** The pilot count; hovering lists who is there and in what (when the map shares pilots). */
function NodePilots({
  count,
  mine,
  pilots,
}: {
  count: number;
  mine: boolean;
  pilots: SystemNodeData['pilots'];
}) {
  const text = `${count} tracked pilot${count === 1 ? '' : 's'} here${mine ? ', you among them' : ''}`;
  const badge = (
    <span className={`${styles.pilots} nodrag`} data-mine={mine || undefined} aria-label={text} tabIndex={0}>
      <Users aria-hidden />
      {count}
    </span>
  );
  if (!pilots?.length) return badge;
  return (
    <Tooltip
      side="bottom"
      align="end"
      content={
        <ul className={styles.pilotList} aria-label="Pilots here">
          {pilots.map((p) => (
            <li key={p.id} data-mine={p.mine || undefined}>
              <span>{p.name}</span>
              <span className={styles.pilotShip}>{p.ship ?? 'ship unknown'}</span>
            </li>
          ))}
        </ul>
      }
    >
      {badge}
    </Tooltip>
  );
}

/** K-space and Pochven: where the node names the region (wormholes show their statics instead). */
function isKnownSpace(info: UniverseSystemDto): boolean {
  const c = info.whClass;
  return !(c !== null && ((c >= 1 && c <= 6) || (c >= 12 && c <= 18)));
}

/** Everything the node leaves out, for its tooltip. */
export function systemTooltip(
  system: MapSystemDto,
  info: UniverseSystemDto | undefined,
  intel?: SystemIntelDto,
): string {
  const name = nodeName(system, info);
  const lines = [name === info?.name || !info ? name : `${name} (${info.name})`];
  if (system.temporaryName) lines.push(`Temporary name: ${system.temporaryName}`);
  // A wormhole's region and constellation are codes (C-R00014) that tell a pilot nothing.
  if (info && isKnownSpace(info))
    lines.push(`${info.regionName} · ${info.constellationName} · security ${info.security.toFixed(2)}`);
  lines.push(`Status: ${STATUS_LABEL[system.status]}`);
  if (info?.effect)
    lines.push(`${WORMHOLE_EFFECTS[info.effect].name}: ${WORMHOLE_EFFECTS[info.effect].summary}`);
  if (info?.shattered) lines.push('Shattered system');
  if (intel?.sovereignty?.holder.name)
    lines.push(
      `${intel.sovereignty.kind === 'faction' ? 'Faction space' : 'Sovereignty'}: ${intel.sovereignty.holder.name}`,
    );
  if (intel && intel.kills1h > 0) lines.push(`Kills in the last hour: ${intel.kills1h}`);
  if (info?.statics.length) lines.push(`Statics: ${info.statics.join(', ')}`);
  if (system.locked) lines.push('Locked');
  if (!system.visible) lines.push('Hidden from the map');
  if (system.description.trim()) lines.push(`Notes: ${system.description.trim().slice(0, 200)}`);
  return lines.join('\n');
}

function PillContent({ info }: { info: UniverseSystemDto | undefined }) {
  const pill = classPill(info);
  const style =
    pill.kind === 'security'
      ? { background: pill.background }
      : pill.kind === 'class'
        ? { background: cssVar(pill.token) }
        : undefined;
  return (
    <span className={styles.pill} data-kind={pill.kind} style={style}>
      {pill.label}
    </span>
  );
}

/** Statics as plain text: the hole type, then where it leads in that place's colour ("D845 HS"). */
function StaticsText({ statics, facts }: { statics: readonly string[]; facts: boolean }) {
  if (statics.length === 0) return null;
  return facts ? <StaticsWithFacts statics={statics} /> : <StaticsList statics={statics} types={NO_TYPES} />;
}

const NO_TYPES: ReadonlyMap<string, WormholeTypeDto> = new Map();

/** The wormhole catalogue needs an account; public views name only where statics lead. */
function StaticsWithFacts({ statics }: { statics: readonly string[] }) {
  return <StaticsList statics={statics} types={useWormholeTypes()} />;
}

/** The statics with their facts (mass, per-jump mass, lifetime) on hover. */
function StaticsList({
  statics,
  types,
}: {
  statics: readonly string[];
  types: ReadonlyMap<string, WormholeTypeDto>;
}) {
  return (
    <ul className={styles.statics} aria-label="Statics">
      {statics.map((type) => {
        const to = wormholeDestination(type);
        const where = to ? WORMHOLE_DESTINATION_LABEL[to] : null;
        return (
          <li key={type} title={staticFacts(type, types.get(type))}>
            {/* Only where it leads on the card; the type code is in the tooltip and the details. */}
            {where ? (
              <span className={styles.to} style={{ color: cssVar(destinationToken(to)) }}>
                {where}
              </span>
            ) : (
              <span className={styles.code}>{type}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The one system node, built for a glance: a box in a neutral hairline frame whose background the
 * status tints (Wanderer's way), as wide as its own content: the designation pill and the name;
 * the statics (or the region), the corner marks, the kills and the pilot count. Above it, left to
 * right: its Labels, its custom label, the bookmark code and its Tags. Below it: the nearest hub of
 * an exit on the left, who holds the system on the right. Everything else is in the tooltip.
 */
export const SystemNode = memo(function SystemNode({
  data,
  selected,
  isConnectable,
}: NodeProps<SystemNodeType>) {
  const {
    system,
    info,
    systemLabels,
    tags,
    characters,
    mapId,
    bookmark,
    hub,
    mine,
    intel,
    standing,
    pulse,
    withAccount,
    pilots,
    routeHub,
  } = data;
  const toast = useToast();
  const name = nodeName(system, info);
  // A status someone set wins; an unmarked system takes one from the holder's standing.
  const derived = system.status === 'unknown' ? statusFromStanding(standing) : null;
  const status = derived ?? system.status;
  const kills = intel?.kills1h ?? 0;

  const copyBookmark = (e: MouseEvent) => {
    e.stopPropagation();
    if (!bookmark) return;
    void navigator.clipboard?.writeText(bookmark).then(
      () => toast({ title: `Copied ${bookmark}`, tone: 'success', duration: 1800 }),
      () => toast({ title: 'Could not copy to the clipboard', tone: 'warning' }),
    );
  };
  const square = hub?.space ? ROUTE_SPACE_COLOR[hub.space] : undefined;

  return (
    <div
      className={styles.node}
      data-selected={selected || undefined}
      data-hidden={!system.visible || undefined}
      data-status={status}
      data-derived={derived ? true : undefined}
      data-pulse={pulse || undefined}
      style={{ '--node-tint-image': statusTint(status) } as CSSProperties}
      title={
        systemTooltip(system, info, intel) +
        (derived ? `\n${STATUS_LABEL[derived]} from your standing towards the holder` : '')
      }
    >
      {SIDES.map((side) => (
        <Handle
          key={side}
          id={side}
          type="source"
          position={side}
          isConnectable={isConnectable}
          className={styles.handle}
        />
      ))}

      <div className={styles.above}>
        {(systemLabels.length > 0 || system.customLabel) && (
          <ul className={styles.labels} aria-label="Labels">
            {systemLabels.map((l) => (
              <li
                key={l.id}
                className={styles.systemLabel}
                title={l.description ? `${l.name}: ${l.description}` : `Label ${l.name}`}
              >
                {l.name}
              </li>
            ))}
            {system.customLabel && (
              <li className={styles.systemLabel} data-custom title={`Custom label ${system.customLabel}`}>
                {system.customLabel}
              </li>
            )}
          </ul>
        )}
        {bookmark && (
          <button
            type="button"
            className={`${styles.bookmark} nodrag nopan`}
            title={`Bookmark ${bookmark}: click to copy`}
            onClick={copyBookmark}
          >
            {bookmark}
          </button>
        )}
        {tags.length > 0 && (
          <ul className={styles.labels} aria-label="Tags">
            {tags.map((t) => (
              <li
                key={t.id}
                className={styles.label}
                style={{ '--label-color': t.color } as CSSProperties}
                title={t.description ? `${t.name}: ${t.description}` : t.name}
              >
                {t.name}
              </li>
            ))}
          </ul>
        )}
        <span className={styles.badges}>
          <PluginSlot slot="nodeBadge" props={{ mapId, solarSystemId: system.solarSystemId }} />
        </span>
      </div>

      <div className={styles.row}>
        <PillContent info={info} />
        <span className={styles.name}>{name}</span>
        <EffectDot effect={info?.effect} />
        <ShatteredMark shattered={info?.shattered} />
      </div>

      <div className={styles.line}>
        <StaticsText statics={info?.statics ?? []} facts={withAccount !== false} />
        {info && !system.customName && isKnownSpace(info) && (
          <span className={styles.region} title={`${info.regionName} › ${info.constellationName}`}>
            {info.whClass === 25 ? info.constellationName : info.regionName}
          </span>
        )}
        <span className={styles.end}>
          {system.description.trim() && (
            <span
              className={styles.lock}
              data-notes
              title={`Notes: ${system.description.trim().slice(0, 200)}`}
            >
              <MessageSquareText aria-label="Has notes" />
            </span>
          )}
          {routeHub && (
            <span
              className={styles.lock}
              data-hub={routeHub}
              title={routeHub === 'map' ? "One of the map's route hubs" : 'One of your route hubs'}
            >
              <MapPin aria-label="Route hub" />
            </span>
          )}
          {system.locked && (
            <span className={styles.lock} title="Locked: cannot be moved or removed" data-locked>
              <Lock aria-label="Locked" />
            </span>
          )}
          {/* Live counts sit in fixed slots, so a count going 3 -> 12 never resizes the node. */}
          {kills > 0 && (
            <span className={styles.slot} data-slot="kills">
              <NodeKills
                mapId={mapId}
                solarSystemId={system.solarSystemId}
                kills={kills}
                list={withAccount !== false}
              />
            </span>
          )}
          {characters > 0 && (
            <span className={styles.slot} data-slot="pilots">
              <NodePilots count={characters} mine={!!mine} pilots={pilots} />
            </span>
          )}
        </span>
      </div>

      {hub && (
        <span className={styles.hub} title={nearestHubTitle(hub, info?.name ?? name)}>
          {hub.name} {hub.jumps}j
          {square && (
            <span
              className={styles.square}
              data-space={hub.space}
              style={{ background: square }}
              aria-hidden
            />
          )}
        </span>
      )}

      <NodeSovereignty
        intel={intel}
        className={styles.sov}
        {...(standing != null ? { standing: standingTone(standing) } : {})}
      />
    </div>
  );
});
