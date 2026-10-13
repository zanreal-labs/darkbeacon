'use client';

import { LayoutGrid, RotateCcw } from 'lucide-react';
import type { SlotEntry } from '../../plugins/registry';
import {
  IconButton,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from '../../ui';
import { CORE_WIDGETS, pluginWidgetId } from './layout';
import type { WidgetsController } from './useWidgetsLayout';

/**
 * The top bar's widgets menu (Wanderer's Widgets settings): a switch per widget, plugin widgets
 * after the core ones, all of them hidden for a moment, and Reset layout.
 */
export function WidgetsMenu({
  controller,
  plugins,
  shown,
  onShownChange,
  className,
}: {
  controller: WidgetsController;
  plugins: readonly SlotEntry<'widget'>[];
  /** All windows shown, or all hidden for a moment. */
  shown: boolean;
  onShownChange(shown: boolean): void;
  className?: string;
}) {
  const keepOpen = (e: Event) => e.preventDefault();
  const items = [
    ...CORE_WIDGETS.map((w) => ({ id: w.id as string, title: w.title as string })),
    ...plugins.map((p) => ({ id: pluginWidgetId(p), title: p.title })),
  ];
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton
          variant="secondary"
          className={className}
          label="Widgets"
          data-off={shown ? undefined : true}
          icon={<LayoutGrid />}
        />
      </MenuTrigger>
      <MenuContent align="end">
        <MenuCheckboxItem
          checked={shown}
          onCheckedChange={(on) => onShownChange(on === true)}
          onSelect={keepOpen}
        >
          Show widgets
        </MenuCheckboxItem>
        <MenuSeparator />
        <MenuLabel>Widgets</MenuLabel>
        {items.map((item) => (
          <MenuCheckboxItem
            key={item.id}
            checked={controller.isVisible(item.id)}
            disabled={!shown}
            onCheckedChange={(on) => controller.setShown(item.id, on === true)}
            onSelect={keepOpen}
          >
            {item.title}
          </MenuCheckboxItem>
        ))}
        <MenuSeparator />
        <MenuItem
          icon={<RotateCcw />}
          onSelect={() => {
            controller.reset();
            onShownChange(true);
          }}
        >
          Reset layout
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
