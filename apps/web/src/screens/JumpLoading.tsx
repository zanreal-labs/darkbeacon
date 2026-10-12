import { Spinner } from '../ui';
import styles from '../jump/jump.module.css';

/** What the jump planner shows until the star map is ready; also the server's Suspense fallback. */
export function JumpLoading({ label = 'Loading the star map…' }: { label?: string }) {
  return (
    <div className={styles.page} data-immersive>
      <div className={styles.center} role="status">
        <Spinner label={label} />
        <span>{label}</span>
      </div>
    </div>
  );
}
