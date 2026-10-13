'use client';

import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { BookOpen } from 'lucide-react';
import { track } from '../lib/telemetry';
import { Tooltip } from '../ui';
import { closeWormholeReference, openWormholeReference, useWormholeReference } from './open';
import shellStyles from '../shell/AppShell.module.css';
import styles from './reference.module.css';

// The table and its data load the first time someone opens it, not with every page.
const WormholeReference = lazy(() =>
  import('./WormholeReference').then((m) => ({ default: m.WormholeReference })),
);

/** The key that opens the reference anywhere in the app. */
export const REFERENCE_KEY = 'W';

/** Keys typed into a field, or pressed inside a menu or another dialog, are not shortcuts. */
function ownedElsewhere(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  return (
    el.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) ||
    !!el.closest('[role="dialog"], [role="menu"], [role="listbox"]')
  );
}

/**
 * The one wormhole types reference of the app, mounted by the shell: it opens from the rail, the
 * help menu, the W key, the map's menus and any type code (`openWormholeReference("U210")`).
 */
export function WormholeReferenceHost() {
  const state = useWormholeReference();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (e.key.toUpperCase() !== REFERENCE_KEY || ownedElsewhere(e.target)) return;
      e.preventDefault();
      track('shortcut_used', { shortcut: 'wormhole_reference' });
      openWormholeReference();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (state.opened === 0) return null;
  return (
    <Suspense fallback={null}>
      <WormholeReference
        // A new opening (another type code) starts with its own search.
        key={state.opened}
        open={state.open}
        onOpenChange={(open) => {
          if (!open) closeWormholeReference();
        }}
        initialQuery={state.query}
      />
    </Suspense>
  );
}

/** The rail's book icon: opens the reference over whatever page is open. */
export function WormholeReferenceRailButton() {
  const { open } = useWormholeReference();
  return (
    <Tooltip content={`Wormhole types (${REFERENCE_KEY})`} side="right">
      <button
        type="button"
        className={shellStyles.railLink}
        aria-label="Wormhole types"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts={REFERENCE_KEY}
        onClick={() => openWormholeReference()}
      >
        <BookOpen />
      </button>
    </Tooltip>
  );
}

/**
 * A wormhole type code that opens the reference at that type (a signature's "U210", the type of
 * a connection). Clicks stop here, so the row under it is not selected as well.
 */
export function TypeReferenceButton({
  code,
  children,
  className,
}: {
  code: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`${styles.typeButton} ${className ?? ''}`}
      title={`${code}: open it in the wormhole types reference`}
      onClick={(e) => {
        e.stopPropagation();
        openWormholeReference(code);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {children}
    </button>
  );
}
