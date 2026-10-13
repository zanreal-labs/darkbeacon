import { ValidationError } from '@darkbeacon/core';
import {
  emptyDump,
  int,
  isRow,
  readAll,
  readComment,
  readConnection,
  readHubIds,
  readPassage,
  readSignature,
  readStructure,
  readSystem,
  readSystemLabels,
  text,
  time,
  type WandererMapDump,
} from './wanderer.js';

/** The export versions this reader knows; newer ones are refused with a clear message. */
const KNOWN_VERSIONS = [1, 2];

export type ExportFormat = 'map-data' | 'map-settings' | 'api-backup';

/**
 * Reads a file Wanderer wrote. Three shapes are understood:
 *
 * - `map-data`: the map contents export (`version`, `exported_at`, `map`, `systems`,
 *   `connections`, `signatures`, `comments`, `structures`);
 * - `map-settings`: the export on the map's settings page (`systems` keyed by `id`, `hubs`,
 *   `connections` with `source`/`target`);
 * - `api-backup`: what `GET /api/maps/:map/systems` answers (`{ data: { systems, connections } }`),
 *   as Wanderer's own backup example saves it.
 *
 * Throws a ValidationError naming what is wrong when the file is none of these.
 */
export function readExportFile(document: unknown, fileName: string | null, now: number): WandererMapDump {
  if (!isRow(document))
    throw new ValidationError('This file is not a Wanderer export (expected a JSON object)');
  const format = exportFormat(document);
  if (!format)
    throw new ValidationError(
      'This file is not a Wanderer export: it has no systems. Export the map from Wanderer and upload that file.',
    );
  const body: Record<string, unknown> =
    format === 'api-backup' ? (document.data as Record<string, unknown>) : document;
  if (format === 'map-data') {
    const version = int(document.version);
    if (version === null || !KNOWN_VERSIONS.includes(version))
      throw new ValidationError(
        `This Wanderer export has version ${String(document.version)}; Darkbeacon reads versions ${KNOWN_VERSIONS.join(' and ')}`,
      );
  }
  const map = isRow(body.map) ? body.map : {};
  const name = text(map.name) ?? (fileName ? fileName.replace(/\.json$/i, '') : null);
  const readAt = (format === 'map-data' ? time(document.exported_at) : null) ?? now;
  const dump = emptyDump(
    { kind: 'wanderer-file', host: 'file', slug: text(map.slug) ?? name ?? 'export', name },
    readAt,
  );
  dump.map = { name, slug: text(map.slug), description: text(map.description), scope: text(map.scope) };
  dump.systemLabels = readSystemLabels(map.system_labels);
  dump.labelNames = Object.fromEntries(dump.systemLabels.map((l) => [l.id, l.name]));
  dump.systems = readAll(body.systems, readSystem, 'systems', dump.rejected);
  dump.connections = readAll(body.connections, readConnection, 'connections', dump.rejected);
  dump.signatures = readAll(body.signatures, readSignature, 'signatures', dump.rejected);
  dump.structures = readAll(body.structures, readStructure, 'structures', dump.rejected);
  dump.comments = readAll(body.comments, readComment, 'comments', dump.rejected);
  dump.passages = readAll(body.passages, readPassage, 'passages', dump.rejected);
  // The settings export's `hubs`, or a map export's `map.hubs` where Wanderer writes them.
  dump.hubs = readHubIds(body.hubs ?? map.hubs);
  if (format !== 'map-data') {
    dump.warnings.push(
      'This export holds systems and connections only: signatures, structures, comments and access lists come over the API.',
    );
  } else {
    dump.warnings.push(
      'Access lists are not part of Wanderer export files; import over the API to bring them.',
    );
  }
  return dump;
}

export function exportFormat(document: Record<string, unknown>): ExportFormat | null {
  if (Array.isArray(document.systems)) return document.version !== undefined ? 'map-data' : 'map-settings';
  if (isRow(document.data) && Array.isArray(document.data.systems)) return 'api-backup';
  return null;
}
