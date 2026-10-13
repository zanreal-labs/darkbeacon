'use client';

import type { SignatureGroup } from '@darkbeacon/shared';
import { GROUP_LABEL } from './facts';
import { groupShown, kindShown, setSignaturePrefs, useSignaturePrefs } from './prefs';
import styles from '../widgets/widgets.module.css';

const ANOMALY_GROUPS: SignatureGroup[] = ['combat', 'ore', 'relic', 'data', 'gas'];

/**
 * Show or hide the folded results by group, and the other scanner rows (ships, structures): the
 * same filters as the signature settings, remembered in this browser, one chip each.
 */
export function OtherFilters() {
  const prefs = useSignaturePrefs();
  return (
    <div className={styles.othersFilter} role="group" aria-label="Show">
      {ANOMALY_GROUPS.map((g) => (
        <button
          key={g}
          type="button"
          className={styles.filterChip}
          aria-pressed={groupShown(prefs, g)}
          onClick={() => setSignaturePrefs({ groups: { ...prefs.groups, [g]: !groupShown(prefs, g) } })}
        >
          {GROUP_LABEL[g]}
        </button>
      ))}
      <button
        type="button"
        className={styles.filterChip}
        aria-pressed={kindShown(prefs, 'other')}
        onClick={() => setSignaturePrefs({ kinds: { ...prefs.kinds, other: !kindShown(prefs, 'other') } })}
      >
        Other
      </button>
    </div>
  );
}
