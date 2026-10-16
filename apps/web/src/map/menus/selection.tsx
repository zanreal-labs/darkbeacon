'use client';

import type { LabelDto, MapSystemDto, SystemLabelDto, SystemStatus } from '@darkbeacon/shared';
import { CircleDot, Copy, Lock, LockOpen, Tags, Trash2, Type } from 'lucide-react';
import type { MenuItem } from '../../components/ContextMenu';
import type { MapPermissions } from '../../lib/roles';
import { lockedHere } from '../sharing/chain';

/*
 * The menu of a selection of several systems (right click on one of them, or on the selection's
 * box): status, Labels and Tags for all of them at once, copy, lock, remove. Short, details in
 * submenus, like the system menu.
 */

export interface SelectionMenuContext {
  systems: readonly MapSystemDto[];
  /** Selected connections (removed with "Remove"). */
  connections: number;
  can: MapPermissions;
  statusOptions: ReadonlyArray<{ value: SystemStatus; label: string; color?: string }>;
  /** The map's Labels (WH1...) and Tags. */
  systemLabels: readonly SystemLabelDto[];
  tags: readonly LabelDto[];
  /** How many of the selection Delete would remove (unlocked, no rally). */
  removable: number;
  onStatus(status: SystemStatus): void;
  onLabel(labelId: string, on: boolean): void;
  onTag(tagId: string, on: boolean): void;
  onLock(locked: boolean): void;
  /** Absent when the viewer may not copy systems off this map. */
  onCopy?(): void;
  onRemove(): void;
}

const sep: MenuItem = { kind: 'separator' };

function groups(...parts: MenuItem[][]): MenuItem[] {
  return parts.filter((p) => p.length > 0).flatMap((p, i) => (i === 0 ? p : [sep, ...p]));
}

/** On when every selected system has it. */
const allHave = (systems: readonly MapSystemDto[], has: (s: MapSystemDto) => boolean) =>
  systems.length > 0 && systems.every(has);

export function selectionMenu(ctx: SelectionMenuContext): MenuItem[] {
  const { systems, can } = ctx;
  const statuses = new Set(systems.map((s) => s.status));
  const one = statuses.size === 1 ? [...statuses][0] : undefined;
  const edit: MenuItem[] = [];
  if (can.edit) {
    const current = ctx.statusOptions.find((o) => o.value === one);
    edit.push({
      kind: 'submenu',
      label: 'Status',
      icon: <CircleDot />,
      hint: current?.label ?? (statuses.size > 1 ? 'Mixed' : undefined),
      hintSwatch: current ? { color: current.color } : undefined,
      items: ctx.statusOptions.map((o) => ({
        kind: 'radio',
        label: o.label,
        checked: o.value === one,
        swatch: { color: o.color },
        onSelect: () => ctx.onStatus(o.value),
      })),
    });
    if (ctx.systemLabels.length > 0)
      edit.push({
        kind: 'submenu',
        label: 'Labels',
        icon: <Type />,
        items: ctx.systemLabels.map((l) => {
          const on = allHave(systems, (s) => s.systemLabelIds.includes(l.id));
          return {
            kind: 'check',
            label: l.description ? `${l.name} — ${l.description}` : l.name,
            checked: on,
            onSelect: () => ctx.onLabel(l.id, !on),
          };
        }),
      });
    if (ctx.tags.length > 0)
      edit.push({
        kind: 'submenu',
        label: 'Tags',
        icon: <Tags />,
        items: ctx.tags.map((t) => {
          const on = allHave(systems, (s) => s.labelIds.includes(t.id));
          return {
            kind: 'check',
            label: t.name,
            title: t.description || undefined,
            checked: on,
            swatch: { color: t.color, shape: 'square' },
            onSelect: () => ctx.onTag(t.id, !on),
          };
        }),
      });
  }
  if (can.manage) {
    // This map's own locks: one a merged map holds is lifted there, one system at a time.
    const locked = allHave(systems, lockedHere);
    edit.push({
      kind: 'action',
      label: locked ? 'Unlock' : 'Lock',
      icon: locked ? <LockOpen /> : <Lock />,
      onSelect: () => ctx.onLock(!locked),
    });
  }
  const copy: MenuItem[] = ctx.onCopy
    ? [{ kind: 'action', label: 'Copy', icon: <Copy />, shortcut: 'Ctrl+C', onSelect: ctx.onCopy }]
    : [];
  const total = ctx.removable + ctx.connections;
  const remove: MenuItem[] =
    can.edit && total > 0
      ? [
          {
            kind: 'action',
            label:
              ctx.removable === systems.length
                ? 'Remove from map'
                : `Remove ${ctx.removable} of ${systems.length}`,
            icon: <Trash2 />,
            danger: true,
            shortcut: 'Del',
            onSelect: ctx.onRemove,
          },
        ]
      : [];
  return groups(edit, copy, remove);
}
