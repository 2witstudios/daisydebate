import type { Presence } from '../../types/presence/presence';
import styles from './presence-dot.module.css';

export type PresenceDotProps = {
  readonly presence: Presence;
};

export function PresenceDot({ presence }: PresenceDotProps) {
  return (
    <span
      className={`${styles.dot} ${styles[presence]}`}
      role="status"
      aria-label={presence}
    />
  );
}
