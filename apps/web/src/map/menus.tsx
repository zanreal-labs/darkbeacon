'use client';

import {
  Bubbled,
  ConnectionType,
  CUSTOM_LABEL_MAX,
  LifetimeMark,
  MassStatus,
  ShipSize,
  SystemStatus,
  TimeStatus,
  type CharacterDto,
  type ConnectionDto,
  type LabelDto,
  type MapSystemDto,
  type SystemLabelDto,
} from '@darkbeacon/shared';
import { cssVar } from '@darkbeacon/theme-sdk';
import {
  CircleDashed,
  CircleDot,
  Clock,
  Hourglass,
  Copy,
  EyeOff,
  LocateFixed,
  Lock,
  LockOpen,
  Maximize,
  PencilLine,
  PiggyBank,
  Plus,
  Puzzle,
  Route,
  Ship,
  Tags,
  Trash2,
  TriangleAlert,
  Type,
  Weight,
} from 'lucide-react';
import type { MenuItem } from '../components/ContextMenu';
import type { MapPermissions } from '../lib/roles';
import { SlotItem } from '../plugins/PluginSlot';
import type { SlotEntry } from '../plugins/registry';
import type { ToastInput } from '../ui';
import { SHIP_SIZE_LABEL } from './ConnectionEdge';
import { hubMenu, waypointMenu, type HubMenuContext } from './menus/routes';
import { passageMenuItems } from './menus/passages';
import { STATUS_LABEL } from './nodeFacts';
import type { MapStore } from './useMapStore';
import { connectionSignatureItems, paneSignatureItems } from './menus/signatures';
import { signaturePrefs } from './signatures/prefs';
import { holderStandingMenu, type HolderStanding } from './menus/intel';

/*
 * The map's context menus. Short top levels with the details in submenus; only what the user
 * may do is shown (the server checks again). Notes, signatures and intel live in the dock, not
 * here. Plugin items go into one "More" submenu at the bottom.
 */

export const statusOptions = SystemStatus.options.map((s) => ({
  value: s,
  label: STATUS_LABEL[s],
  color: s === 'unknown' ? undefined : cssVar(`status-${s}`),
}));

type Commands = Pick<MapStore, 'updateSystem' | 'removeSystem' | 'updateConnection' | 'removeConnection'>;
type Notify = (toast: ToastInput) => void;

const sep: MenuItem = { kind: 'separator' };

/** Joins groups of items with separators, leaving out the empty ones. */
function groups(...parts: MenuItem[][]): MenuItem[] {
  return parts.filter((p) => p.length > 0).flatMap((p, i) => (i === 0 ? p : [sep, ...p]));
}

function radios<T extends string>(
  values: readonly T[],
  current: T,
  row: (v: T) => Omit<Extract<MenuItem, { kind: 'radio' }>, 'kind' | 'checked' | 'onSelect'>,
  onSelect: (v: T) => void,
): MenuItem[] {
  return values.map((v) => ({
    kind: 'radio',
    checked: v === current,
    onSelect: () => onSelect(v),
    ...row(v),
  }));
}

export interface SystemMenuContext {
  mapId: string;
  system: MapSystemDto;
  name: string;
  /** The map's Tags (`labels` in the data). */
  labels: LabelDto[];
  /** The map's Labels (WH1...); none means the map has no list, a custom label still works. */
  systemLabels?: readonly SystemLabelDto[];
  can: MapPermissions;
  store: Commands;
  plugins: readonly SlotEntry<'systemContextMenu'>[];
  /** The user's own characters; those whose EVE grant allows it can set the in-game route. */
  characters?: readonly CharacterDto[];
  notify?: Notify;
  /** Opens the map's Labels settings (managers). */
  onManageLabels?(): void;
  /** The map's and the viewer's hubs, for the hub toggles. */
  routes?: HubMenuContext;
  /** Opens the map's Tags settings (managers). */
  onManageTags?(): void;
  /** The alliance holding the system and the viewer's standing towards it (system intel). */
  holder?: HolderStanding;
}

/** "WH1" or "WH1 — Static to high-sec": the name alone is often a letter or two. */
export function systemLabelText(label: Pick<SystemLabelDto, 'name' | 'description'>): string {
  return label.description ? `${label.name} — ${label.description}` : label.name;
}

/**
 * Labels ▸: the custom label, then the map's Labels to toggle, Clear and (managers) Manage. The
 * hint names what is on: "WH1 bait".
 */
function labelsMenu(
  ctx: SystemMenuContext,
  update: (patch: Parameters<Commands['updateSystem']>[1]) => void,
) {
  const { system, can } = ctx;
  const list = ctx.systemLabels ?? [];
  const onIds = system.systemLabelIds.filter((id) => list.some((l) => l.id === id));
  const shown = [
    ...list.filter((l) => onIds.includes(l.id)).map((l) => l.name),
    ...(system.customLabel ? [system.customLabel] : []),
  ];
  const manage = can.manage && ctx.onManageLabels;
  const item: MenuItem = {
    kind: 'submenu',
    label: 'Labels',
    icon: <Type />,
    hint: shown.length > 0 ? shown.join(' ') : undefined,
    items: groups(
      [
        {
          kind: 'input',
          label: 'Custom label',
          value: system.customLabel ?? '',
          hint: system.customLabel ?? undefined,
          placeholder: 'e.g. bait',
          maxLength: CUSTOM_LABEL_MAX,
          onSubmit: (customLabel) => update({ customLabel: customLabel || null }),
        },
        ...(system.customLabel
          ? [
              {
                kind: 'action',
                label: 'Remove custom label',
                onSelect: () => update({ customLabel: null }),
              } satisfies MenuItem,
            ]
          : []),
      ],
      list.map((l) => ({
        kind: 'check',
        label: systemLabelText(l),
        checked: onIds.includes(l.id),
        onSelect: () =>
          update({
            systemLabelIds: onIds.includes(l.id) ? onIds.filter((x) => x !== l.id) : [...onIds, l.id],
          }),
      })),
      [
        ...(onIds.length > 0
          ? [
              {
                kind: 'action',
                label: 'Clear',
                onSelect: () => update({ systemLabelIds: [] }),
              } satisfies MenuItem,
            ]
          : []),
        ...(manage
          ? [{ kind: 'action', label: 'Manage labels…', onSelect: ctx.onManageLabels! } satisfies MenuItem]
          : []),
      ],
    ),
  };
  return item;
}

export function systemMenu(ctx: SystemMenuContext): MenuItem[] {
  const { system, can, store } = ctx;
  const id = system.solarSystemId;
  const update = (patch: Parameters<Commands['updateSystem']>[1]) => void store.updateSystem(id, patch);

  const edit: MenuItem[] = [];
  if (can.edit) {
    const status = statusOptions.find((o) => o.value === system.status);
    edit.push({
      kind: 'submenu',
      label: 'Status',
      icon: <CircleDot />,
      hint: status?.label,
      hintSwatch: { color: status?.color },
      items: statusOptions.map((o) => ({
        kind: 'radio',
        label: o.label,
        checked: o.value === system.status,
        swatch: { color: o.color },
        onSelect: () => update({ status: o.value }),
      })),
    });
    edit.push(labelsMenu(ctx, update));
    const manageTags = can.manage && ctx.onManageTags;
    if (ctx.labels.length > 0 || manageTags) {
      const on = system.labelIds.filter((l) => ctx.labels.some((tag) => tag.id === l)).length;
      edit.push({
        kind: 'submenu',
        label: 'Tags',
        icon: <Tags />,
        hint: on > 0 ? String(on) : undefined,
        items: groups(
          ctx.labels.map((t) => ({
            kind: 'check',
            label: t.name,
            title: t.description || undefined,
            checked: system.labelIds.includes(t.id),
            swatch: { color: t.color, shape: 'square' },
            onSelect: () =>
              update({
                labelIds: system.labelIds.includes(t.id)
                  ? system.labelIds.filter((x) => x !== t.id)
                  : [...system.labelIds, t.id],
              }),
          })),
          manageTags ? [{ kind: 'action', label: 'Manage tags…', onSelect: ctx.onManageTags! }] : [],
        ),
      });
    }
    edit.push({
      kind: 'input',
      label: 'Rename',
      icon: <PencilLine />,
      value: system.customName ?? '',
      placeholder: ctx.name,
      maxLength: 64,
      onSubmit: (customName) => update({ customName: customName || null }),
    });
  }
  if (can.manage) {
    edit.push({
      kind: 'action',
      label: system.locked ? 'Unlock' : 'Lock',
      icon: system.locked ? <LockOpen /> : <Lock />,
      onSelect: () => update({ locked: !system.locked }),
    });
  }
  // A locked system cannot be hidden (the server refuses), so the toggle goes with the lock.
  if (can.edit && !system.locked) {
    edit.push({
      kind: 'check',
      label: 'Hide from routes',
      icon: <EyeOff />,
      checked: !system.visible,
      onSelect: () => update({ visible: !system.visible }),
    });
  }

  const go: MenuItem[] = [
    ...waypointMenu(ctx.characters, { solarSystemId: id, name: ctx.name }, ctx.notify),
    ...hubMenu(ctx.routes, { solarSystemId: id, name: ctx.name }),
    ...(ctx.holder ? [holderStandingMenu(ctx.holder)] : []),
  ];
  go.push({
    kind: 'action',
    label: 'Copy name',
    icon: <Copy />,
    onSelect: () =>
      void navigator.clipboard
        ?.writeText(ctx.name)
        .then(() => ctx.notify?.({ title: `Copied ${ctx.name}`, tone: 'success', duration: 2000 }))
        .catch(() => {}),
  });
  go.push(...more(ctx.plugins, (close) => ({ mapId: ctx.mapId, solarSystemId: id, close })));

  const remove: MenuItem[] =
    can.edit && !system.locked
      ? [
          {
            kind: 'action',
            label: 'Remove from map',
            icon: <Trash2 />,
            danger: true,
            onSelect: () => void store.removeSystem(id),
          },
        ]
      : [];
  return groups(edit, go, remove);
}

export interface ConnectionMenuContext {
  mapId: string;
  connection: ConnectionDto;
  /** Display names of the two ends, for the bubble options. */
  names?: { source: string; target: string };
  can: MapPermissions;
  store: Commands;
  plugins: readonly SlotEntry<'connectionContextMenu'>[];
  onLogJump?(): void;
  onPlanRoll?(): void;
}

const MASS_LABEL: Record<MassStatus, string> = { fresh: 'Fresh', reduced: 'Reduced', critical: 'Critical' };
/** The same colours as the line on the map (edgeStyle). */
const MASS_COLOR: Record<MassStatus, string> = {
  fresh: cssVar('edge-color'),
  reduced: cssVar('edge-mass-reduced'),
  critical: cssVar('edge-mass-critical'),
};
const TIME_LABEL: Record<TimeStatus, string> = { normal: 'Normal', eol: 'End of life' };
const SIZE_NAME: Record<ShipSize, string> = {
  small: 'Frigate',
  medium: 'Medium',
  large: 'Large',
  xlarge: 'Freighter',
  capital: 'Capital',
};
const TYPE_LABEL: Record<ConnectionType, string> = {
  wormhole: 'Wormhole',
  gate: 'Gate',
  bridge: 'Jump bridge',
};

export function connectionMenu(ctx: ConnectionMenuContext): MenuItem[] {
  const { connection: c, can, store } = ctx;
  const update = store.updateConnection.bind(null, c.id);
  const wormhole = c.type === 'wormhole';
  const names = ctx.names ?? { source: 'source', target: 'target' };
  const BUBBLED_LABEL: Record<Bubbled, string> = {
    none: 'None',
    source: `Near ${names.source}`,
    target: `Near ${names.target}`,
    both: 'Both ends',
  };

  const state: MenuItem[] = [];
  const flags: MenuItem[] = [];
  const locked = c.locked ?? false;
  // A locked connection is changed by managers only; others see it as it is.
  if (can.edit && (!locked || can.manage)) {
    if (wormhole) {
      state.push(
        {
          kind: 'submenu',
          label: 'Mass',
          icon: <Weight />,
          hint: MASS_LABEL[c.massStatus],
          hintSwatch: { color: MASS_COLOR[c.massStatus], shape: 'line' },
          items: radios(
            MassStatus.options,
            c.massStatus,
            (v) => ({ label: MASS_LABEL[v], swatch: { color: MASS_COLOR[v], shape: 'line' } }),
            (massStatus) => update({ massStatus }),
          ),
        },
        {
          kind: 'submenu',
          label: 'Time',
          icon: <Clock />,
          hint: c.timeStatus === 'eol' ? 'EOL' : 'Normal',
          items: radios(
            TimeStatus.options,
            c.timeStatus,
            (v) => ({
              label: TIME_LABEL[v],
              hint: v === 'eol' ? 'under 4 h' : undefined,
              swatch: {
                color: cssVar(v === 'eol' ? 'edge-time-eol' : 'edge-color'),
                shape: 'line',
                dashed: v === 'eol',
              },
            }),
            (timeStatus) => update({ timeStatus }),
          ),
        },
        {
          kind: 'submenu',
          label: 'Lifetime left',
          icon: <Hourglass />,
          hint: c.lifetime ? `< ${c.lifetime.mark}` : undefined,
          items: radios(
            ['none', ...LifetimeMark.options] as const,
            c.lifetime?.mark ?? 'none',
            (v) => ({ label: v === 'none' ? 'Not marked' : `Less than ${v}` }),
            (v) => update({ lifetime: v === 'none' ? null : v }),
          ),
        },
        {
          kind: 'submenu',
          label: 'Size',
          icon: <Ship />,
          hint: SHIP_SIZE_LABEL[c.shipSize],
          items: radios(
            ShipSize.options,
            c.shipSize,
            (v) => ({ label: SIZE_NAME[v], hint: SHIP_SIZE_LABEL[v] }),
            (shipSize) => update({ shipSize }),
          ),
        },
      );
    }
    state.push(
      {
        kind: 'submenu',
        label: 'Bubbled',
        icon: <CircleDashed />,
        hint: c.bubbled === 'none' ? undefined : c.bubbled === 'both' ? 'Both' : BUBBLED_LABEL[c.bubbled],
        items: radios(
          Bubbled.options,
          c.bubbled,
          (v) => ({ label: BUBBLED_LABEL[v] }),
          (bubbled) => update({ bubbled }),
        ),
      },
      {
        kind: 'submenu',
        label: 'Type',
        icon: <Route />,
        hint: TYPE_LABEL[c.type],
        items: radios(
          ConnectionType.options,
          c.type,
          (v) => ({ label: TYPE_LABEL[v] }),
          (type) => update({ type }),
        ),
      },
    );
    flags.push({
      kind: 'check',
      label: 'Dangerous',
      icon: <TriangleAlert />,
      checked: c.dangerous,
      onSelect: () => update({ dangerous: !c.dangerous }),
    });
    if (wormhole)
      flags.push({
        kind: 'check',
        label: 'Mass saved',
        icon: <PiggyBank />,
        checked: c.massSaved,
        onSelect: () => update({ massSaved: !c.massSaved }),
      });
  }
  if (can.manage)
    flags.push({
      kind: 'action',
      label: locked ? 'Unlock' : 'Lock',
      icon: locked ? <LockOpen /> : <Lock />,
      onSelect: () => update({ locked: !locked }),
    });
  flags.push(...connectionSignatureItems(c, can));
  flags.push(...more(ctx.plugins, (close) => ({ mapId: ctx.mapId, connectionId: c.id, close })));
  const remove: MenuItem[] =
    can.edit && (!locked || can.manage)
      ? [
          {
            kind: 'action',
            label: 'Remove connection',
            icon: <Trash2 />,
            danger: true,
            onSelect: () =>
              void store.removeConnection(c.id, {
                withSignatures: signaturePrefs().deleteConnectionWithSigs,
              }),
          },
        ]
      : [];
  return groups(state, passageMenuItems(ctx), flags, remove);
}

export interface PaneMenuContext {
  can: MapPermissions;
  /** Starts adding a system at the pointer. */
  onAddSystem(): void;
  onFitChain(): void;
  onCenterOnMe(): void;
}

export function paneMenu(ctx: PaneMenuContext): MenuItem[] {
  return groups(
    ctx.can.edit
      ? [{ kind: 'action', label: 'Add system here…', icon: <Plus />, onSelect: ctx.onAddSystem }]
      : [],
    [
      { kind: 'action', label: 'Fit chain', icon: <Maximize />, shortcut: 'F', onSelect: ctx.onFitChain },
      {
        kind: 'action',
        label: 'Center on me',
        icon: <LocateFixed />,
        shortcut: 'C',
        onSelect: ctx.onCenterOnMe,
      },
    ],
    paneSignatureItems(),
  );
}

/** Plugin items, all in one "More" submenu at the bottom. */
function more<S extends 'systemContextMenu' | 'connectionContextMenu'>(
  entries: readonly SlotEntry<S>[],
  props: (close: () => void) => Parameters<SlotEntry<S>['component']>[0],
): MenuItem[] {
  if (entries.length === 0) return [];
  return [
    {
      kind: 'submenu',
      label: 'More',
      icon: <Puzzle />,
      items: entries.map((entry) => ({
        kind: 'custom',
        key: entry.key,
        render: (close) => <SlotItem entry={entry} props={props(close)} />,
      })),
    },
  ];
}
