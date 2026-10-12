import type { SignatureGroup } from '@darkbeacon/shared';

/**
 * Parser for the clipboard of the in-game probe scanner. Each line is tab separated:
 *
 *   ABC-123 <TAB> Cosmic Signature <TAB> Wormhole <TAB> Unstable Wormhole <TAB> 100.0% <TAB> 4.32 AU
 *
 * id, scan group, group, type name, signal strength, distance. Group and name stay empty until
 * the signature is scanned far enough. Labels depend on the client language, so they live in
 * one table per language; add a language by adding an entry to SCANNER_LANGUAGES.
 */
export interface ScannerLanguage {
  code: string;
  /** Scan group of cosmic signatures, the only rows that become signatures. */
  cosmicSignature: string;
  /** Scan groups that are understood but not stored (anomalies are always visible anyway). */
  ignoredScanGroups: string[];
  /** Group column -> signature group. */
  groups: Record<string, SignatureGroup>;
  /** Type names that say nothing beyond the group, e.g. every wormhole is "Unstable Wormhole". */
  genericNames: string[];
}

export const ENGLISH: ScannerLanguage = {
  code: 'en',
  cosmicSignature: 'Cosmic Signature',
  ignoredScanGroups: ['Cosmic Anomaly'],
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

export const SCANNER_LANGUAGES: readonly ScannerLanguage[] = [ENGLISH];

export interface ParsedSignature {
  eveId: string;
  group: SignatureGroup;
  /** Site name; null when not scanned yet or when it is a generic name. */
  name: string | null;
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
      (l) => l.cosmicSignature === scanGroup || l.ignoredScanGroups.includes(scanGroup),
    );
    if (!EVE_ID.test(eveId) || !language) {
      skipped.push(line);
      continue;
    }
    if (language.cosmicSignature !== scanGroup) continue;
    byId.set(eveId, {
      eveId,
      group: language.groups[group] ?? 'unknown',
      name: name && !language.genericNames.includes(name) ? name : null,
    });
  }
  return { signatures: [...byId.values()], skipped };
}
