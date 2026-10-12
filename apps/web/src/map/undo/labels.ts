import type { UpdateConnectionRequest, UpdateSystemRequest } from '@darkbeacon/shared';

/*
 * What a gesture did, for the undo toast ("Undone: renamed J123456"): short, the thing named,
 * no ids.
 */

const SYSTEM_FIELDS: Array<[keyof UpdateSystemRequest, (name: string) => string]> = [
  ['status', (n) => `Changed the status of ${n}`],
  ['customName', (n) => `Renamed ${n}`],
  ['temporaryName', (n) => `Changed the temporary name of ${n}`],
  ['systemLabelIds', (n) => `Changed the labels of ${n}`],
  ['customLabel', (n) => `Changed the custom label of ${n}`],
  ['labelIds', (n) => `Changed the tags of ${n}`],
  ['tag', (n) => `Changed the tag of ${n}`],
  ['description', (n) => `Changed the notes of ${n}`],
  ['position', (n) => `Moved ${n}`],
];

export function systemChangeLabel(name: string, patch: UpdateSystemRequest): string {
  if (patch.locked !== undefined) return `${patch.locked ? 'Locked' : 'Unlocked'} ${name}`;
  if (patch.visible === false) return `Removed ${name}`;
  if (patch.visible === true) return `Put ${name} back`;
  const keys = Object.keys(patch);
  if (keys.length === 1) {
    const found = SYSTEM_FIELDS.find(([field]) => field === keys[0]);
    if (found) return found[1](name);
  }
  return `Changed ${name}`;
}

export function connectionChangeLabel(ends: string, patch: UpdateConnectionRequest): string {
  const keys = Object.keys(patch);
  if (keys.length === 1) {
    switch (keys[0]) {
      case 'massStatus':
        return `Changed the mass of ${ends}`;
      case 'timeStatus':
      case 'lifetime':
        return `Changed the lifetime of ${ends}`;
      case 'shipSize':
        return `Changed the size of ${ends}`;
      case 'dangerous':
        return `${patch.dangerous ? 'Marked' : 'Unmarked'} ${ends} dangerous`;
      case 'locked':
        return `${patch.locked ? 'Locked' : 'Unlocked'} ${ends}`;
      default:
        break;
    }
  }
  return `Changed ${ends}`;
}

export const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
