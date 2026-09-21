import type { ReactNode } from 'react';
import styles from './status-line.module.css';

export type StatusLineProps = {
  readonly tone?: 'online' | 'live' | 'neutral';
  readonly children: ReactNode;
};

const toneClass = {
  online: styles.online,
  live: styles.live,
  neutral: styles.neutral,
} as const;

export function StatusLine({ tone = 'neutral', children }: StatusLineProps) {
  return (
    <span className={`${styles.status} ${toneClass[tone]}`}>
      <span className={styles.dot} aria-hidden="true" />
      {children}
    </span>
  );
}
