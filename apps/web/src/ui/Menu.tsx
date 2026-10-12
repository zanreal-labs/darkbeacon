'use client';

import type { ComponentProps, ReactNode } from 'react';
import { ContextMenu as C, DropdownMenu as D } from 'radix-ui';
import { Check, ChevronRight } from 'lucide-react';
import { cx } from './cx';
import styles from './overlay.module.css';

/*
 * Dropdown menus (`Menu*`) and right-click menus (`ContextMenu*`) share one look. Items take an
 * optional lucide icon, a keyboard shortcut hint and `tone="danger"` for destructive actions.
 */

interface ItemExtras {
  icon?: ReactNode;
  shortcut?: string;
  tone?: 'default' | 'danger';
}

export const Menu = D.Root;
export const MenuTrigger = D.Trigger;
export const MenuGroup = D.Group;
export const MenuRadioGroup = D.RadioGroup;
export const MenuSub = D.Sub;

export function MenuContent({
  className,
  sideOffset = 6,
  align = 'end',
  ...props
}: ComponentProps<typeof D.Content>) {
  return (
    <D.Portal>
      <D.Content
        className={cx(styles.surface, className)}
        sideOffset={sideOffset}
        align={align}
        collisionPadding={8}
        {...props}
      />
    </D.Portal>
  );
}

export function MenuItem({
  icon,
  shortcut,
  tone,
  href,
  children,
  className,
  ...props
}: Omit<ComponentProps<typeof D.Item>, 'asChild'> & ItemExtras & { href?: string }) {
  const content = (
    <>
      {icon}
      <span>{children}</span>
      {shortcut && <kbd className={styles.shortcut}>{shortcut}</kbd>}
    </>
  );
  // A plain link (full page navigation, e.g. OAuth); for app routes use onSelect + navigate.
  if (href) {
    return (
      <D.Item className={cx(styles.item, className)} data-tone={tone} asChild {...props}>
        <a href={href}>{content}</a>
      </D.Item>
    );
  }
  return (
    <D.Item className={cx(styles.item, className)} data-tone={tone} {...props}>
      {content}
    </D.Item>
  );
}

export function MenuCheckboxItem({
  icon,
  children,
  className,
  ...props
}: ComponentProps<typeof D.CheckboxItem> & ItemExtras) {
  return (
    <D.CheckboxItem className={cx(styles.item, className)} {...props}>
      {icon}
      <span>{children}</span>
      <D.ItemIndicator className={styles.itemIndicator}>
        <Check />
      </D.ItemIndicator>
    </D.CheckboxItem>
  );
}

export function MenuRadioItem({
  icon,
  children,
  className,
  ...props
}: ComponentProps<typeof D.RadioItem> & ItemExtras) {
  return (
    <D.RadioItem className={cx(styles.item, className)} {...props}>
      {icon}
      <span>{children}</span>
      <D.ItemIndicator className={styles.itemIndicator}>
        <Check />
      </D.ItemIndicator>
    </D.RadioItem>
  );
}

export function MenuSubTrigger({
  icon,
  children,
  className,
  ...props
}: ComponentProps<typeof D.SubTrigger> & ItemExtras) {
  return (
    <D.SubTrigger className={cx(styles.item, className)} {...props}>
      {icon}
      <span>{children}</span>
      <span className={styles.itemIndicator}>
        <ChevronRight />
      </span>
    </D.SubTrigger>
  );
}

export function MenuSubContent({ className, ...props }: ComponentProps<typeof D.SubContent>) {
  return (
    <D.Portal>
      <D.SubContent
        className={cx(styles.surface, className)}
        sideOffset={4}
        collisionPadding={8}
        {...props}
      />
    </D.Portal>
  );
}

export function MenuLabel({ className, ...props }: ComponentProps<typeof D.Label>) {
  return <D.Label className={cx(styles.label, className)} {...props} />;
}

export function MenuSeparator({ className, ...props }: ComponentProps<typeof D.Separator>) {
  return <D.Separator className={cx(styles.separator, className)} {...props} />;
}

export const ContextMenu = C.Root;
export const ContextMenuTrigger = C.Trigger;
export const ContextMenuGroup = C.Group;
export const ContextMenuRadioGroup = C.RadioGroup;
export const ContextMenuSub = C.Sub;

export function ContextMenuContent({ className, ...props }: ComponentProps<typeof C.Content>) {
  return (
    <C.Portal>
      <C.Content className={cx(styles.surface, className)} collisionPadding={8} {...props} />
    </C.Portal>
  );
}

export function ContextMenuItem({
  icon,
  shortcut,
  tone,
  children,
  className,
  ...props
}: ComponentProps<typeof C.Item> & ItemExtras) {
  return (
    <C.Item className={cx(styles.item, className)} data-tone={tone} {...props}>
      {icon}
      <span>{children}</span>
      {shortcut && <kbd className={styles.shortcut}>{shortcut}</kbd>}
    </C.Item>
  );
}

export function ContextMenuCheckboxItem({
  icon,
  children,
  className,
  ...props
}: ComponentProps<typeof C.CheckboxItem> & ItemExtras) {
  return (
    <C.CheckboxItem className={cx(styles.item, className)} {...props}>
      {icon}
      <span>{children}</span>
      <C.ItemIndicator className={styles.itemIndicator}>
        <Check />
      </C.ItemIndicator>
    </C.CheckboxItem>
  );
}

export function ContextMenuRadioItem({
  icon,
  children,
  className,
  ...props
}: ComponentProps<typeof C.RadioItem> & ItemExtras) {
  return (
    <C.RadioItem className={cx(styles.item, className)} {...props}>
      {icon}
      <span>{children}</span>
      <C.ItemIndicator className={styles.itemIndicator}>
        <Check />
      </C.ItemIndicator>
    </C.RadioItem>
  );
}

export function ContextMenuSubTrigger({
  icon,
  children,
  className,
  ...props
}: ComponentProps<typeof C.SubTrigger> & ItemExtras) {
  return (
    <C.SubTrigger className={cx(styles.item, className)} {...props}>
      {icon}
      <span>{children}</span>
      <span className={styles.itemIndicator}>
        <ChevronRight />
      </span>
    </C.SubTrigger>
  );
}

export function ContextMenuSubContent({ className, ...props }: ComponentProps<typeof C.SubContent>) {
  return (
    <C.Portal>
      <C.SubContent
        className={cx(styles.surface, className)}
        sideOffset={4}
        collisionPadding={8}
        {...props}
      />
    </C.Portal>
  );
}

export function ContextMenuLabel({ className, ...props }: ComponentProps<typeof C.Label>) {
  return <C.Label className={cx(styles.label, className)} {...props} />;
}

export function ContextMenuSeparator({ className, ...props }: ComponentProps<typeof C.Separator>) {
  return <C.Separator className={cx(styles.separator, className)} {...props} />;
}
