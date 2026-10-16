import type { CSSProperties } from 'react';
import type { SignatureDto } from '@darkbeacon/shared';

/*
 * Scan results as the game shows them.
 *
 * Signal strength. The probe scanner colours a result's scan progress in four bands (CCP, "The
 * future of probe and directional scanning UI", 2017-02-13, shipped in 119.3):
 *   0 % to 24.9 % red, 25 % to 74.9 % orange, 75 % to 99.9 % yellow, 100 % and warpable green.
 *   https://www.eveonline.com/article/the-future-of-probe-and-directional-scanning-ui
 *   https://www.eveonline.com/article/patch-notes-for-yc119.3-release
 * The group shows from 25 %, the name from 75 %, the site is warpable at 100 %:
 *   https://wiki.eveuniversity.org/Cosmic_signature
 *
 * Signatures and anomalies. Anomalies are at 100 % from the first sweep and need no probes;
 * signatures start at 0 % and are probed down (https://wiki.eveuniversity.org/Odyssey). In space
 * "the anomalies appear as green diamonds", "the signatures are red and have animated circles
 * around them" (CCP, "Sensor overlay changes in EVE Odyssey", 2013-06-03):
 *   https://www.eveonline.com/news/view/sensor-overlay-changes-in-eve-odyssey
 * On the solar system map green dots are what you can warp to, red ones signatures still being
 * scanned (https://wiki.eveuniversity.org/Exploration).
 *
 * Groups. 119.3 "added icons for each type of exploration site to the Probe Scanner window and
 * solar system map": the group is told by its icon (ours, drawn after the game's: a vortex, a
 * reticle, a chip, a ruin, a cloud, a rock), the colour of the mark says how far it was scanned
 * (a wormhole's aside, below), and the outline what it is (circle: signature, diamond: anomaly).
 *
 * Wormholes. In the game an identified wormhole is told apart from the sites by its own icon in
 * the probe scanner (119.3, above). Its colour is not documented: the CCP posts above and EVE
 * University's Exploration and Cosmic signature pages give the scan bands only, no hue per group,
 * and a wormhole scanned down is the same green as a site. Players coming from Wanderer know
 * wormholes in a colour of their own ("Color signatures by type", on by default: wormholes sky
 * blue, sites lime, unscanned rose; assets/js/hooks/Mapper/components/mapInterface/widgets/
 * SystemSignatures/helpers/rowStyles.ts in our fork). So an identified wormhole (group known,
 * whatever its strength) takes its own colour in the ID and Group cells, its mark included (a
 * narrow window shows only the mark of the group), with a bar at the row's start; how far it was
 * probed stays in the group cell's title. An unscanned result stays red: it is no wormhole yet.
 * The hue is ours, as no source gives one: the map's W-space class pill (`pill-wormhole`,
 * #7b93ff), a blue-violet clear of the scan reds, oranges, yellows and greens and of the security
 * colours (1.0 is cyan #2fefef, 0.9 teal); on light themes a darker one (#3550d0, 6.5 : 1 on
 * white).
 *
 * Hex. The sources name the colours but give no values; these are the client's hues as close as
 * we could match them, fixed in every theme like SECURITY_COLORS. On light themes the game's
 * orange, yellow and green are unreadable on white (2.5, 1.5 and 2.0 : 1), so a darker variant of
 * each (and of the red) is used there; all are at least 4.5 : 1 on their surfaces.
 */

export type ScanColor = 'red' | 'orange' | 'yellow' | 'green';

export const SCAN_COLORS: Readonly<Record<ScanColor, { game: string; light: string }>> = {
  red: { game: '#f04a3a', light: '#c22a1c' },
  orange: { game: '#f08a24', light: '#a85a00' },
  yellow: { game: '#e8d23a', light: '#7d6c00' },
  green: { game: '#4fd04a', light: '#17802a' },
};

/** An identified wormhole's colour (see Wormholes above): the W-space pill's, darker on light themes. */
export const WORMHOLE_COLOR = { game: '#7b93ff', light: '#3550d0' } as const;

/** The colours as custom properties (`--scan-red`, ..., `--scan-wormhole`), the game's on dark themes. */
export const SCAN_COLOR_VARS = Object.fromEntries(
  Object.entries({ ...SCAN_COLORS, wormhole: WORMHOLE_COLOR }).map(([name, c]) => [
    `--scan-${name}`,
    `light-dark(${c.light}, ${c.game})`,
  ]),
) as CSSProperties;

/** A result known to be a wormhole: a cosmic signature with its group identified as one. */
export function isIdentifiedWormhole(sig: Pick<SignatureDto, 'kind' | 'group'>): boolean {
  return (sig.kind ?? 'signature') === 'signature' && sig.group === 'wormhole';
}

/** The probe scanner's colour for a signal strength in percent. */
export function strengthColor(percent: number): ScanColor {
  if (percent >= 100) return 'green';
  if (percent >= 75) return 'yellow';
  if (percent >= 25) return 'orange';
  return 'red';
}

/**
 * How far a result was scanned, from what is known of it (the strength itself is not kept): an
 * anomaly is always at 100 %; a signature without a group is under 25 %, with a group but no name
 * (nor a type or a link, for a hole) under 75 %, and with one, scanned down. Other results (ships,
 * structures) have no scan state here.
 */
export function scanStrength(
  sig: Pick<SignatureDto, 'kind' | 'group' | 'name' | 'type' | 'connectionId'>,
): number | null {
  const kind = sig.kind ?? 'signature';
  if (kind === 'other') return null;
  if (kind === 'anomaly') return 100;
  if (sig.group === 'unknown') return 0;
  const known = sig.name || (sig.group === 'wormhole' && (sig.type || sig.connectionId));
  return known ? 100 : 25;
}

export function scanColor(sig: Parameters<typeof scanStrength>[0]): ScanColor | null {
  const strength = scanStrength(sig);
  return strength === null ? null : strengthColor(strength);
}

/** "Cosmic signature, not scanned yet" and the like, for the group cell's title. */
export function scanTitle(sig: Parameters<typeof scanStrength>[0]): string | undefined {
  const kind = sig.kind ?? 'signature';
  if (kind === 'other') return undefined;
  if (kind === 'anomaly') return 'Cosmic anomaly: no probing needed';
  const strength = scanStrength(sig)!;
  if (strength < 25) return 'Cosmic signature: not scanned yet (under 25 %)';
  if (strength < 100) return 'Cosmic signature: group known, not scanned down (under 75 %)';
  return 'Cosmic signature: scanned down';
}
