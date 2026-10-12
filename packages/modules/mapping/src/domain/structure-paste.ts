import { STRUCTURE_TYPES, type StructureStatus } from '@darkbeacon/shared';

/**
 * Parser for structures copied from the game. Two shapes:
 *
 * - d-scan or overview rows, one structure per line, tab separated: type id, name, type name,
 *   distance (`35832 <TAB> J123456 - Home <TAB> Astrahus <TAB> 1,234 km`). Only Upwell types of
 *   `STRUCTURE_TYPES` are read; the system name the game puts before a structure name is dropped.
 *   Russian clients may mark type names with `*`.
 * - a timer: exactly three lines, the structure's name, its distance and its state
 *   (`Reinforced until 2025.01.13 23:51`, EVE time). Anchoring keeps its word; anything else
 *   with a date is a reinforcement.
 */
export interface ParsedStructure {
  typeId: number;
  typeName: string;
  name: string;
}

export interface ParsedTimer {
  name: string;
  status: StructureStatus;
  endsAt: number;
}

export type StructurePaste =
  | { kind: 'structures'; structures: ParsedStructure[]; skipped: string[] }
  | { kind: 'timer'; timer: ParsedTimer };

const SYSTEM_PREFIX = /^J\d{6}\s*-\s*/i;
const TIMER = /until\s+(\d{4})\.(\d{2})\.(\d{2})(?:\s+(\d{1,2}):(\d{2}))?/i;

/** A structure's name without the system name the game puts first. */
export function structureName(text: string): string {
  return text.trim().replace(SYSTEM_PREFIX, '').trim();
}

export function parseStructurePaste(text: string): StructurePaste {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 3 && TIMER.test(lines[2]!)) {
    const [, y, mo, d, h = '0', mi = '0'] = TIMER.exec(lines[2]!)!;
    const word = lines[2]!.split(/\s+/)[0]!.toLowerCase();
    return {
      kind: 'timer',
      timer: {
        name: structureName(lines[0]!),
        status: word === 'anchoring' ? 'anchoring' : 'reinforced',
        endsAt: Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)),
      },
    };
  }
  const structures: ParsedStructure[] = [];
  const skipped: string[] = [];
  for (const line of lines) {
    const cells = line
      .split('\t')
      .map((c) => c.trim())
      .filter(Boolean);
    const typeId = Number(cells[0]);
    const typeName = STRUCTURE_TYPES[typeId];
    if (cells.length !== 4 || !typeName || cells[2]!.replace(/\*/g, '').trim() !== typeName) {
      skipped.push(line);
      continue;
    }
    const name = structureName(cells[1]!);
    if (!structures.some((s) => s.typeId === typeId && s.name === name))
      structures.push({ typeId, typeName, name: name || typeName });
  }
  return { kind: 'structures', structures, skipped };
}
