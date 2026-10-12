'use client';

import { ArrowDown, ArrowUp, RotateCcw } from 'lucide-react';
import { Button, Dialog, DialogClose, DialogContent, IconButton, Switch } from '../../ui';
import {
  DEFAULT_SIDEBAR_LAYOUT,
  moveSection,
  orderedSections,
  SIDEBAR_SECTIONS,
  useSidebarLayout,
} from './layout';
import styles from './sidebar.module.css';

/**
 * Which sections the system sidebar shows and in what order (Wanderer's widget switches and
 * reset). Saved with my preferences, so every browser shows the same sidebar.
 */
export function SectionsDialog({
  open,
  onOpenChange,
  extra = [],
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Plugin widgets by id and title. */
  extra?: readonly { id: string; title: string }[];
}) {
  const [layout, setLayout] = useSidebarLayout();
  const extraIds = extra.map((e) => e.id);
  const order = orderedSections(layout, extraIds);
  const titles = new Map<string, string>([
    ...SIDEBAR_SECTIONS.map((s) => [s.id, s.title] as [string, string]),
    ...extra.map((e) => [e.id, e.title] as [string, string]),
  ]);
  const changed = layout.hidden.length > 0 || layout.order.length > 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Sidebar sections"
        description="Show, hide and order the sections of the system sidebar. Saved with your preferences."
        width={420}
        footer={
          <>
            <Button
              variant="ghost"
              icon={<RotateCcw />}
              disabled={!changed}
              onClick={() => setLayout(DEFAULT_SIDEBAR_LAYOUT)}
            >
              Reset
            </Button>
            <DialogClose asChild>
              <Button variant="primary">Done</Button>
            </DialogClose>
          </>
        }
      >
        <ol className={styles.layoutList}>
          {order.map((id, i) => {
            const title = titles.get(id) ?? id;
            const shown = !layout.hidden.includes(id);
            return (
              <li key={id} className={styles.layoutRow} data-hidden={!shown || undefined}>
                <Switch
                  className={styles.layoutSwitch}
                  checked={shown}
                  onCheckedChange={(on) =>
                    setLayout({
                      hidden: on ? layout.hidden.filter((h) => h !== id) : [...layout.hidden, id],
                    })
                  }
                  label={title}
                />
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={`Move ${title} up`}
                  icon={<ArrowUp />}
                  disabled={i === 0}
                  onClick={() => setLayout(moveSection(layout, id, -1, extraIds))}
                />
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={`Move ${title} down`}
                  icon={<ArrowDown />}
                  disabled={i === order.length - 1}
                  onClick={() => setLayout(moveSection(layout, id, 1, extraIds))}
                />
              </li>
            );
          })}
        </ol>
      </DialogContent>
    </Dialog>
  );
}
