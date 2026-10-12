import type { ShareScope } from '@darkbeacon/shared';
import { listWords } from './scope-builder';

/** What each part of a public link shows, in the order offered. Topology is always part of it. */
export const SHARE_SCOPE_TEXT: Record<ShareScope, { label: string; description: string; noun: string }> = {
  topology: {
    label: 'Systems and connections',
    description: 'Where systems are and how they connect. Always part of the link.',
    noun: 'systems',
  },
  connectionStatus: {
    label: 'Connection status',
    description: 'Mass, time left, ship size, bubbles and danger of each connection.',
    noun: 'connection status',
  },
  signatures: {
    label: 'Signatures',
    description: 'What has been scanned in each system, with its notes.',
    noun: 'signatures',
  },
  labels: {
    label: 'Bookmark labels',
    description: 'The bookmark names given to systems.',
    noun: 'bookmark labels',
  },
  intel: {
    label: 'System intel',
    description: 'Status, tags, custom names and notes of systems, and the hubs the map stages from.',
    noun: 'notes',
  },
  characters: {
    label: 'Pilots',
    description: 'Tracked characters, their names and where they are right now.',
    noun: 'pilots',
  },
};

export const SHARE_SCOPE_ORDER: readonly ShareScope[] = [
  'topology',
  'connectionStatus',
  'signatures',
  'labels',
  'intel',
  'characters',
];

/** "Signatures, notes and pilots are not shared", or null when the link shows everything. */
export function notSharedSentence(scopes: readonly ShareScope[]): string | null {
  const missing = SHARE_SCOPE_ORDER.filter((s) => s !== 'topology' && !scopes.includes(s)).map(
    (s) => SHARE_SCOPE_TEXT[s].noun,
  );
  if (missing.length === 0) return null;
  const text = listWords(missing);
  const verb = missing.length === 1 && missing[0] === 'connection status' ? 'is' : 'are';
  return `${text.charAt(0).toUpperCase()}${text.slice(1)} ${verb} not shared`;
}
