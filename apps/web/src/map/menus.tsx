import {
  Bubbled,
  ConnectionType,
  MassStatus,
  ShipSize,
  SystemStatus,
  TimeStatus,
  type ConnectionDto,
  type LabelDto,
  type MapSystemDto,
} from '@wormwright/shared';
import { cssVar } from '@wormwright/theme-sdk';
import type { MenuItem } from '../components/ContextMenu';
import type { MapPermissions } from '../lib/roles';
import { SlotItem } from '../plugins/PluginSlot';
import type { SlotEntry } from '../plugins/registry';
import { SHIP_SIZE_LABEL } from './ConnectionEdge';
import type { MapStore } from './useMapStore';

const STATUS_LABEL: Record<SystemStatus, string> = {
  unknown: 'Unknown',
  home: 'Home',
  friendly: 'Friendly',
  empty: 'Empty',
  occupied: 'Occupied',
  warning: 'Warning',
  hostile: 'Hostile',
};

export const statusOptions = SystemStatus.options.map((s) => ({
  value: s,
  label: STATUS_LABEL[s],
  color: s === 'unknown' ? undefined : cssVar(`status-${s}`),
}));

type Commands = Pick<MapStore, 'updateSystem' | 'removeSystem' | 'updateConnection' | 'removeConnection'>;

export interface SystemMenuContext {
  mapId: string;
  system: MapSystemDto;
  name: string;
  labels: LabelDto[];
  can: MapPermissions;
  store: Commands;
  plugins: readonly SlotEntry<'systemContextMenu'>[];
  onEdit(): void;
}

/** Only the actions the user may perform; the server checks again. */
export function systemMenu(ctx: SystemMenuContext): MenuItem[] {
  const { system, can, store } = ctx;
  const id = system.solarSystemId;
  const items: MenuItem[] = [];
  if (can.edit) {
    items.push({
      kind: 'choice',
      label: 'Status',
      value: system.status,
      options: statusOptions,
      onSelect: (status) => void store.updateSystem(id, { status: status as SystemStatus }),
    });
    for (const label of ctx.labels) {
      const on = system.labelIds.includes(label.id);
      items.push({
        kind: 'toggle',
        label: `Label: ${label.name}`,
        checked: on,
        onSelect: () =>
          void store.updateSystem(id, {
            labelIds: on ? system.labelIds.filter((l) => l !== label.id) : [...system.labelIds, label.id],
          }),
      });
    }
    items.push({ kind: 'action', label: 'Edit name, tag and notes…', onSelect: ctx.onEdit });
    items.push({
      kind: 'toggle',
      label: 'Hidden',
      checked: !system.visible,
      onSelect: () => void store.updateSystem(id, { visible: !system.visible }),
    });
  }
  if (can.manage) {
    items.push({
      kind: 'toggle',
      label: 'Locked',
      checked: system.locked,
      onSelect: () => void store.updateSystem(id, { locked: !system.locked }),
    });
  }
  items.push({
    kind: 'action',
    label: 'Copy name',
    onSelect: () => void navigator.clipboard?.writeText(ctx.name).catch(() => {}),
  });
  pushPlugins(items, ctx.plugins, (close) => ({ mapId: ctx.mapId, solarSystemId: id, close }));
  if (can.edit && !system.locked) {
    items.push({ kind: 'separator' });
    items.push({
      kind: 'action',
      label: 'Remove from map',
      danger: true,
      onSelect: () => void store.removeSystem(id),
    });
  }
  return items;
}

export interface ConnectionMenuContext {
  mapId: string;
  connection: ConnectionDto;
  can: MapPermissions;
  store: Commands;
  plugins: readonly SlotEntry<'connectionContextMenu'>[];
}

const choice = <T extends string>(
  label: string,
  value: T,
  values: readonly T[],
  names: Record<T, string>,
  onSelect: (v: T) => void,
): MenuItem => ({
  kind: 'choice',
  label,
  value,
  options: values.map((v) => ({ value: v, label: names[v] })),
  onSelect: (v) => onSelect(v as T),
});

export function connectionMenu(ctx: ConnectionMenuContext): MenuItem[] {
  const { connection: c, can, store } = ctx;
  const update = store.updateConnection.bind(null, c.id);
  const items: MenuItem[] = [];
  if (can.edit) {
    items.push(
      choice('Time', c.timeStatus, TimeStatus.options, { normal: 'Normal', eol: 'EOL' }, (timeStatus) =>
        update({ timeStatus }),
      ),
      choice(
        'Mass',
        c.massStatus,
        MassStatus.options,
        { fresh: 'Fresh', reduced: 'Reduced', critical: 'Critical' },
        (massStatus) => update({ massStatus }),
      ),
      choice('Ship size', c.shipSize, ShipSize.options, SHIP_SIZE_LABEL, (shipSize) => update({ shipSize })),
      choice(
        'Type',
        c.type,
        ConnectionType.options,
        { wormhole: 'Wormhole', gate: 'Gate', bridge: 'Bridge' },
        (type) => update({ type }),
      ),
      choice(
        'Bubbled',
        c.bubbled,
        Bubbled.options,
        { none: 'None', source: 'Source', target: 'Target', both: 'Both' },
        (bubbled) => update({ bubbled }),
      ),
      {
        kind: 'toggle',
        label: 'Dangerous',
        checked: c.dangerous,
        onSelect: () => update({ dangerous: !c.dangerous }),
      },
      {
        kind: 'toggle',
        label: 'Mass saved',
        checked: c.massSaved,
        onSelect: () => update({ massSaved: !c.massSaved }),
      },
    );
  }
  pushPlugins(items, ctx.plugins, (close) => ({ mapId: ctx.mapId, connectionId: c.id, close }));
  if (can.edit) {
    items.push({ kind: 'separator' });
    items.push({
      kind: 'action',
      label: 'Remove connection',
      danger: true,
      onSelect: () => void store.removeConnection(c.id),
    });
  }
  return items;
}

function pushPlugins<S extends 'systemContextMenu' | 'connectionContextMenu'>(
  items: MenuItem[],
  entries: readonly SlotEntry<S>[],
  props: (close: () => void) => Parameters<SlotEntry<S>['component']>[0],
) {
  if (entries.length === 0) return;
  items.push({ kind: 'separator' });
  for (const entry of entries) {
    items.push({
      kind: 'custom',
      key: entry.key,
      render: (close) => <SlotItem entry={entry} props={props(close)} />,
    });
  }
}
