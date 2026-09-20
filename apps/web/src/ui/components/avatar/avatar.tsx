import { PresenceDot } from '../presence-dot/presence-dot';
import type { Presence } from '../../types/presence/presence';
import styles from './avatar.module.css';

export type AvatarProps = {
  readonly name: string;
  readonly src?: string | undefined;
  readonly presence?: Presence;
  readonly size?: 'sm' | 'md' | 'lg';
};

const sizeClass = {
  sm: styles.sm,
  md: styles.md,
  lg: styles.lg,
} as const;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

export function Avatar({ name, src, presence, size = 'md' }: AvatarProps) {
  return (
    <span className={`${styles.avatar} ${sizeClass[size]}`}>
      {src ? (
        <img src={src} alt="" className={styles.image} />
      ) : (
        <span className={styles.initials} aria-hidden="true">
          {initials(name)}
        </span>
      )}
      {presence ? (
        <span className={styles.presence}>
          <PresenceDot presence={presence} />
        </span>
      ) : null}
      <span className="visually-hidden">{name}</span>
    </span>
  );
}
