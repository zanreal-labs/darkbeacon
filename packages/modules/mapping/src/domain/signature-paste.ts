import type { SignatureGroup, SignatureKind } from '@darkbeacon/shared';

/**
 * Parser for the clipboard of the in-game probe scanner. Each line is tab separated:
 *
 *   ABC-123 <TAB> Cosmic Signature <TAB> Wormhole <TAB> Unstable Wormhole <TAB> 100.0% <TAB> 4.32 AU
 *
 * id, scan group, group, type name, signal strength, distance. Group and name stay empty until
 * the signature is scanned far enough. Cosmic signatures, cosmic anomalies and the other rows the
 * scanner lists (ships, structures...) are all kept, by kind. Labels depend on the client language, so they live in
 * one table per language; add a language by adding an entry to SCANNER_LANGUAGES.
 */
export interface ScannerLanguage {
  code: string;
  /** Scan group of cosmic signatures. */
  cosmicSignature: string;
  /** Scan group of cosmic anomalies (kept as anomalies). */
  cosmicAnomaly: string;
  /** Other scan groups the scanner lists (ships, structures...), kept as `other` results. */
  otherScanGroups: string[];
  /** Group column -> signature group. */
  groups: Record<string, SignatureGroup>;
  /** Type names that say nothing beyond the group, e.g. every wormhole is "Unstable Wormhole". */
  genericNames: string[];
}

export const ENGLISH: ScannerLanguage = {
  code: 'en',
  cosmicSignature: 'Cosmic Signature',
  cosmicAnomaly: 'Cosmic Anomaly',
  otherScanGroups: ['Ship', 'Structure', 'Deployable', 'Drone', 'Starbase', 'Celestial'],
  groups: {
    Wormhole: 'wormhole',
    'Combat Site': 'combat',
    'Relic Site': 'relic',
    'Data Site': 'data',
    'Gas Site': 'gas',
    'Ore Site': 'ore',
  },
  genericNames: ['Unstable Wormhole'],
};

// Russian, French and German clients, as Wanderer reads them.
export const RUSSIAN: ScannerLanguage = {
  code: 'ru',
  cosmicSignature: 'Скрытый сигнал',
  cosmicAnomaly: 'Космическая аномалия',
  otherScanGroups: ['Корабль', 'Сооружение', 'Полевые блоки', 'Дрон', 'Starbase'],
  groups: {
    Червоточина: 'wormhole',
    'Боевой район': 'combat',
    'Археологический район': 'relic',
    'Информационный район': 'data',
    'Газовый район': 'gas',
    'Астероидный район': 'ore',
  },
  genericNames: ['Нестабильная червоточина'],
};

/** The French client writes "(type)" after the scan group and "(groupe)" after an unknown group. */
export const FRENCH: ScannerLanguage = {
  code: 'fr',
  cosmicSignature: 'Signature cosmique (type)',
  cosmicAnomaly: 'Anomalie cosmique',
  otherScanGroups: ['Vaisseau', 'Structure', 'Déployable', 'Drone', 'Base stellaire'],
  groups: {
    'Trou de ver': 'wormhole',
    'Site de combat': 'combat',
    'Site de reliques': 'relic',
    'Site de données': 'data',
    'Site de collecte de gaz': 'gas',
    'Site de minerai': 'ore',
  },
  genericNames: ['Trou de ver instable'],
};

/** The German client writes "(typ)" after the scan group and "(gruppe)" after an unknown group. */
export const GERMAN: ScannerLanguage = {
  code: 'de',
  cosmicSignature: 'Kosmische Signatur (typ)',
  cosmicAnomaly: 'Kosmische Anomalie',
  otherScanGroups: ['Schiff', 'Struktur', 'Mobile Struktur', 'Drohne', 'Sternenbasis'],
  groups: {
    Wurmloch: 'wormhole',
    Kampfgebiet: 'combat',
    Reliktgebiet: 'relic',
    Datengebiet: 'data',
    Gasgebiet: 'gas',
    Mineraliengebiet: 'ore',
  },
  genericNames: ['Instabiles Wurmloch'],
};

export const SCANNER_LANGUAGES: readonly ScannerLanguage[] = [ENGLISH, RUSSIAN, FRENCH, GERMAN];

/** "Signature cosmique (type)" and "Signature cosmique" are the same scan group. */
const withoutQualifier = (label: string) => label.replace(/\s*\((type|typ|groupe|gruppe)\)$/i, '');
const sameLabel = (a: string, b: string) =>
  withoutQualifier(a).toLowerCase() === withoutQualifier(b).toLowerCase();

export interface ParsedSignature {
  eveId: string;
  kind: SignatureKind;
  group: SignatureGroup;
  /** Site name; null when not scanned yet or when it is a generic name. */
  name: string | null;
  /** For `other` rows: what the scanner calls it (Ship, Structure...) and its group column. */
  type: string | null;
}

export interface SignaturePaste {
  signatures: ParsedSignature[];
  /** Non-empty lines that were not understood. */
  skipped: string[];
}

const EVE_ID = /^[A-Z]{3}-\d{3}$/;

export function parseSignaturePaste(
  text: string,
  languages: readonly ScannerLanguage[] = SCANNER_LANGUAGES,
): SignaturePaste {
  const byId = new Map<string, ParsedSignature>();
  const skipped: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const [id = '', scanGroup = '', group = '', name = ''] = line.split('\t').map((c) => c.trim());
    const eveId = id.toUpperCase();
    const language = languages.find(
      (l) =>
        sameLabel(l.cosmicSignature, scanGroup) ||
        sameLabel(l.cosmicAnomaly, scanGroup) ||
        l.otherScanGroups.some((g) => sameLabel(g, scanGroup)),
    );
    if (!EVE_ID.test(eveId) || !language) {
      skipped.push(line);
      continue;
    }
    const kind: SignatureKind = sameLabel(language.cosmicSignature, scanGroup)
      ? 'signature'
      : sameLabel(language.cosmicAnomaly, scanGroup)
        ? 'anomaly'
        : 'other';
    byId.set(eveId, {
      eveId,
      kind,
      group: Object.entries(language.groups).find(([label]) => sameLabel(label, group))?.[1] ?? 'unknown',
      name: name && !language.genericNames.includes(name) ? name : null,
      type: kind === 'other' ? [scanGroup, group].filter(Boolean).join(' · ') : null,
    });
  }
  return { signatures: [...byId.values()], skipped };
}
