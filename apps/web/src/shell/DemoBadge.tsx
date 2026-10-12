import { Badge, Tooltip } from '../ui';
import styles from './AppShell.module.css';

/** Shown in the top bar while the instance runs in demo mode. */
export function DemoBadge() {
  return (
    <Tooltip content="Demo mode: everyone who opens this instance shares one demo account.">
      <span tabIndex={0} className={styles.demo}>
        <Badge tone="warning" dot>
          Demo<span className={styles.demoWord}> mode</span>
        </Badge>
      </span>
    </Tooltip>
  );
}
