import { effectModifiers, WORMHOLE_EFFECTS, type WormholeEffect } from '@darkbeacon/shared';
import styles from './intel.module.css';

/** What a wormhole effect changes in this class: the summary, then every modifier with its value. */
export function EffectTable({ effect, whClass }: { effect: WormholeEffect; whClass: number | null }) {
  const rows = effectModifiers(effect, whClass);
  return (
    <div className={styles.effectTable}>
      <p>{WORMHOLE_EFFECTS[effect].summary}</p>
      {rows.length > 0 && (
        <table>
          <caption>In a class {whClass} system</caption>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <th scope="row">{r.name}</th>
                <td data-sign={r.percent > 0 ? 'up' : 'down'}>
                  {r.percent > 0 ? '+' : '−'}
                  {Math.abs(r.percent)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
