'use client';

import { useRef } from 'react';
import { FoldVertical, LayoutGrid, Megaphone, RotateCcw, Save } from 'lucide-react';
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
import { pluginWidgetId, SYSTEM_WIDGETS } from './layout';
import type { MotdState } from './MotdWidget';
import type { WidgetsController } from './useWidgetsLayout';

/**
 * The top bar's widgets menu (Wanderer's Widgets settings): a switch per widget, plugin widgets
 * after the core ones, all of them hidden for a moment, windows sized by hand back to their
 * content, and Reset layout. The message of the day comes first: a switch while the map has one
 * (off hides it until it changes), or for its managers a way to write one while it has none.
 */
export function WidgetsMenu({
  controller,
  plugins,
  shown,
  onShownChange,
  save,
  motd,
  className,
}: {
  controller: WidgetsController;
  plugins: readonly SlotEntry<'widget'>[];
  /** All windows shown, or all hidden for a moment. */
  shown: boolean;
  onShownChange(shown: boolean): void;
  /**
   * Keeps the widgets as they are now in the view in use (quick slot 1, 2 or 3): right where the
   * widgets are changed, without going through the Views menu.
   */
  save?: { view: string; changed: boolean; onSave(): void };
  /** The map's message of the day. */
  motd?: MotdState;
  className?: string;
}) {
  const keepOpen = (e: Event) => e.preventDefault();
  // Writing a message of the day: the focus goes to its text field, not back to the menu's button.
  const writing = useRef(false);
  const items = [
    ...SYSTEM_WIDGETS.map((w) => ({ id: w.id as string, title: w.title as string })),
    ...plugins.map((p) => ({ id: pluginWidgetId(p), title: p.title })),
  ];
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton
          variant="secondary"
          className={className}
          label={save?.changed ? `Widgets: unsaved changes to ${save.view}` : 'Widgets'}
          data-off={shown ? undefined : true}
          data-changed={save?.changed || undefined}
          icon={<LayoutGrid />}
        />
      </MenuTrigger>
      <MenuContent
        align="end"
        onCloseAutoFocus={(e) => {
          if (!writing.current) return;
          writing.current = false;
          e.preventDefault();
          document.querySelector<HTMLElement>('[data-widget="motd"] textarea')?.focus();
        }}
      >
        {save?.changed && (
          <>
            <MenuItem icon={<Save />} onSelect={save.onSave}>
              Save
            </MenuItem>
            <MenuSeparator />
          </>
        )}
        <MenuCheckboxItem
          checked={shown}
          onCheckedChange={(on) => onShownChange(on === true)}
          onSelect={keepOpen}
        >
          Show widgets
        </MenuCheckboxItem>
        <MenuSeparator />
        <MenuLabel>Widgets</MenuLabel>
        {motd?.text ? (
          <MenuCheckboxItem
            checked={!motd.hidden}
            disabled={!shown}
            onCheckedChange={(on) => (on === true ? motd.show() : motd.hide())}
            onSelect={keepOpen}
          >
            Message of the day
          </MenuCheckboxItem>
        ) : (
          motd?.canEdit && (
            <MenuItem
              icon={<Megaphone />}
              onSelect={() => {
                writing.current = true;
                onShownChange(true);
                motd.edit();
              }}
            >
              Write a message of the day…
            </MenuItem>
          )
        )}
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
        <MenuItem icon={<FoldVertical />} onSelect={() => controller.fit()}>
          Fit heights to content
        </MenuItem>
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
