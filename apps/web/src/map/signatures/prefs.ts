'use client';

import { useSyncExternalStore } from 'react';
import { SignatureGroup, type SignatureKind } from '@darkbeacon/shared';

/*
 * How this browser shows and handles signatures (Wanderer's signature settings): columns, filters,
 * sorting, lazy delete, the undo window and the cascades. Kept in localStorage under one key, so
 * a preferences export can carry it; everything works with the defaults when storage is blocked.
 */

export const SIGNATURE_PREFS_KEY = 'dbk-signature-prefs';

/** Optional columns; the id, the group (what kind of site it is) and the info are always shown. */
export type SignatureColumn = 'description' | 'added' | 'updated' | 'author';
export type SignatureSortField = 'eveId' | 'group' | 'info' | 'description' | 'added' | 'updated' | 'author';

export interface SignaturePrefs {
  columns: Record<SignatureColumn, boolean>;
  /** Groups shown; a group missing here is shown. */
  groups: Partial<Record<SignatureGroup, boolean>>;
  /** Kinds of scan results shown (signatures, anomalies, the rest); missing: shown. */
  kinds: Partial<Record<SignatureKind, boolean>>;
  sort: { field: SignatureSortField; dir: 'asc' | 'desc' };
  /** Rows tinted by group (wormholes, sites, unknown). */
  colorByGroup: boolean;
  /** "Remove missing" starts on when a system is opened. */
  lazyDelete: boolean;
  /** "Remove missing" stays on after a paste (else it turns itself off). */
  keepLazyDelete: boolean;
  /** Seconds removed signatures can be put back (0: no undo). */
  undoSeconds: 0 | 10 | 30;
  /** Removing a linked signature removes its connection too. */
  deleteConnectionWithSigs: boolean;
  /** Removing a linked signature removes the one that leads back, when it is the only one. */
  backLinks: boolean;
  /** After a jump of yours makes a new connection, offer to link one of the signatures. */
  linkOnSplash: boolean;
  /**
   * When you link a signature, for the system it leads to (bookmark templates, empty: off; as
   * Wanderer's auto temp name, custom label and tag on link, with Labels for tags): copy its
   * bookmark label, give it a temporary name, a custom label, and the Label the template names.
   */
  onLink: { copyLabel: boolean; tempName: string; customLabel: string; label: string };
}

export const DEFAULT_SIGNATURE_PREFS: SignaturePrefs = {
  columns: { description: false, added: true, updated: false, author: false },
  groups: {},
  kinds: {},
  sort: { field: 'added', dir: 'desc' },
  colorByGroup: true,
  lazyDelete: true,
  keepLazyDelete: false,
  undoSeconds: 10,
  deleteConnectionWithSigs: false,
  backLinks: true,
  linkOnSplash: false,
  onLink: { copyLabel: true, tempName: '', customLabel: '', label: '' },
};

/** Older preferences could hide the group column, which is now always shown. */
function withoutGroup(columns: SignaturePrefs['columns'] & { group?: boolean }): SignaturePrefs['columns'] {
  const { group: _group, ...rest } = columns;
  return rest;
}

let cache: SignaturePrefs | null = null;
const listeners = new Set<() => void>();

function read(): SignaturePrefs {
  try {
    const raw = window.localStorage.getItem(SIGNATURE_PREFS_KEY);
    const stored = raw ? (JSON.parse(raw) as Partial<SignaturePrefs>) : {};
    return {
      ...DEFAULT_SIGNATURE_PREFS,
      ...stored,
      columns: withoutGroup({ ...DEFAULT_SIGNATURE_PREFS.columns, ...stored.columns }),
      groups: { ...stored.groups },
      kinds: { ...stored.kinds },
      sort: { ...DEFAULT_SIGNATURE_PREFS.sort, ...stored.sort },
      onLink: { ...DEFAULT_SIGNATURE_PREFS.onLink, ...stored.onLink },
    };
  } catch {
    return DEFAULT_SIGNATURE_PREFS;
  }
}

/** The current preferences (outside React, e.g. in menus). */
export function signaturePrefs(): SignaturePrefs {
  if (typeof window === 'undefined') return DEFAULT_SIGNATURE_PREFS;
  cache ??= read();
  return cache;
}

export function setSignaturePrefs(patch: Partial<SignaturePrefs>): void {
  cache = { ...signaturePrefs(), ...patch };
  try {
    window.localStorage.setItem(SIGNATURE_PREFS_KEY, JSON.stringify(cache));
  } catch {
    // Storage may be blocked; the choice holds until the page is left.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== SIGNATURE_PREFS_KEY) return;
    cache = read();
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useSignaturePrefs(): SignaturePrefs {
  return useSyncExternalStore(subscribe, signaturePrefs, () => DEFAULT_SIGNATURE_PREFS);
}

export const groupShown = (prefs: SignaturePrefs, group: SignatureGroup) => prefs.groups[group] !== false;
export const kindShown = (prefs: SignaturePrefs, kind: SignatureKind | undefined) =>
  prefs.kinds[kind ?? 'signature'] !== false;

export const ALL_GROUPS = SignatureGroup.options;
