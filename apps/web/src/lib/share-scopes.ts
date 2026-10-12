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
    description: 'Mass, time left and ship size of each connection.',
    noun: 'connection status',
  },
  signatures: {
    label: 'Signatures',
    description: 'Signature ids and what they lead to.',
    noun: 'signatures',
  },
  labels: { label: 'Labels', description: "The map's labels on systems.", noun: 'labels' },
  intel: {
    label: 'Intel',
    description: 'Notes, statuses, tags, custom names, structures and kills.',
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
