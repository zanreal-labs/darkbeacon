'use client';

import { useEffect, useRef } from 'react';
import {
  bookmarkChain,
  bookmarkClassLabel,
  bookmarkLabel,
  CUSTOM_LABEL_MAX,
  DEFAULT_BOOKMARK_TEMPLATE,
  renderBookmarkTemplate,
  type BookmarkVars,
  type ConnectionDto,
  type MapDto,
  type MapSystemDto,
  type SignatureDto,
  type UniverseSystemDto,
  type UpdateSystemRequest,
} from '@darkbeacon/shared';
import { useToast } from '../../ui';
import { useMapPreferences } from '../useMapPreferences';
import type { MapStore } from '../useMapStore';
import { signaturePrefs, type SignaturePrefs } from './prefs';

export interface LinkState {
  map: MapDto | null;
  systems: Map<number, MapSystemDto>;
  connections: Map<string, ConnectionDto>;
  signatures: Map<string, SignatureDto>;
}

/**
 * What linking a signature does for the system it leads to, by the preferences: its bookmark
 * label, and the temporary name, custom label and Label the templates give (each null when the
 * preferences leave it alone or it would not change).
 */
export function onLinkChanges(
  signature: SignatureDto,
  state: LinkState,
  universe: Map<number, UniverseSystemDto>,
  options: { template: string; prefs: SignaturePrefs['onLink'] },
): { target: number; label: string | null; patch: UpdateSystemRequest } | null {
  const connection = signature.connectionId ? state.connections.get(signature.connectionId) : undefined;
  if (!connection) return null;
  const target = connection.source === signature.solarSystemId ? connection.target : connection.source;
  const system = state.systems.get(target);
  if (!system) return null;
  const numbering = state.map?.settings.bookmarkNumbering;
  const signatures = new Map(state.signatures).set(signature.id, signature);
  const vars = bookmarkChain({
    systems: [...state.systems.values()],
    connections: [...state.connections.values()],
    signatures: [...signatures.values()],
    classOf: (id) => bookmarkClassLabel(universe.get(id)),
    systemLabels: state.map?.systemLabels,
    startAtZero: numbering?.startAtZero,
    staticsOf: (id) => universe.get(id)?.statics,
  }).get(target);
  if (!vars) return null;
  const values = numbering?.values ?? {};
  const render = (template: string) =>
    template.trim() ? renderBookmarkTemplate(template, vars as BookmarkVars, values) : '';

  const patch: UpdateSystemRequest = {};
  // The signature's own temporary name already went to the system (on the server).
  const tempName = signature.tempName ? '' : render(options.prefs.tempName).slice(0, 64);
  if (tempName && tempName !== system.temporaryName) patch.temporaryName = tempName;
  const customLabel = render(options.prefs.customLabel).slice(0, CUSTOM_LABEL_MAX);
  if (customLabel && customLabel !== system.customLabel) patch.customLabel = customLabel;
  const labelName = render(options.prefs.label).toLowerCase();
  const label = labelName
    ? state.map?.systemLabels.find((l) => l.name.toLowerCase() === labelName)
    : undefined;
  if (label && !system.systemLabelIds.includes(label.id))
    patch.systemLabelIds = [...system.systemLabelIds, label.id];

  const after = { ...vars, ...(patch.temporaryName ? { tempName: patch.temporaryName } : {}) };
  return {
    target,
    label: options.prefs.copyLabel ? bookmarkLabel(options.template, after, values) : null,
    patch,
  };
}

/** Says a signature was linked by this viewer (the panels call it after the link was saved). */
export const SIGNATURE_LINKED = 'dbk:signature-linked';
export function announceLink(signatureId: string, connectionId: string) {
  window.dispatchEvent(new CustomEvent(SIGNATURE_LINKED, { detail: { signatureId, connectionId } }));
}

/** Links a signature through the store and, when that worked, applies what linking does here. */
export async function linkSignature(
  store: Pick<MapStore, 'updateSignature'>,
  signatureId: string,
  connectionId: string | null,
): Promise<boolean> {
  const ok = await store.updateSignature(signatureId, { connectionId });
  if (ok && connectionId) announceLink(signatureId, connectionId);
  return ok;
}

/**
 * Applies `onLinkChanges` when you link a signature (`announceLink`): copies the bookmark label
 * and writes the temporary name, custom label and Label to the system it leads to.
 */
export function useOnLink(
  mapId: string,
  state: LinkState,
  universe: Map<number, UniverseSystemDto>,
  store: Pick<MapStore, 'updateSystem'>,
  enabled: boolean,
) {
  const toast = useToast();
  const { preferences } = useMapPreferences(mapId);
  const latest = useRef({ state, universe, preferences, store, toast, enabled });
  useEffect(() => {
    latest.current = { state, universe, preferences, store, toast, enabled };
  });

  useEffect(() => {
    const onLinked = (e: Event) => {
      const { signatureId, connectionId } = (e as CustomEvent<{ signatureId: string; connectionId: string }>)
        .detail;
      const { state: now, universe: systems, preferences: own, store: commands, toast: say } = latest.current;
      if (!latest.current.enabled) return;
      const signature = now.signatures.get(signatureId);
      if (!signature) return;
      const template =
        own.bookmarkTemplate ?? now.map?.settings.bookmarkTemplate ?? DEFAULT_BOOKMARK_TEMPLATE;
      const changes = onLinkChanges({ ...signature, connectionId }, now, systems, {
        template,
        prefs: signaturePrefs().onLink,
      });
      if (!changes) return;
      if (Object.keys(changes.patch).length > 0) void commands.updateSystem(changes.target, changes.patch);
      const label = changes.label;
      if (label)
        void navigator.clipboard
          ?.writeText(label)
          .then(() =>
            say({ title: `Copied ${label}`, description: 'The bookmark label of the system it leads to.' }),
          )
          .catch(() => {});
    };
    window.addEventListener(SIGNATURE_LINKED, onLinked);
    return () => window.removeEventListener(SIGNATURE_LINKED, onLinked);
  }, []);
}
