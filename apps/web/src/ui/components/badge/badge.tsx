import type { ReactNode } from 'react';
import styles from './badge.module.css';

export type BadgeProps = {
  readonly tone?: 'neutral' | 'live' | 'gold' | 'tier' | 'accent';
  readonly children: ReactNode;
};

const toneClass = {
  neutral: styles.neutral,
  live: styles.live,
  gold: styles.gold,
  tier: styles.tier,
  accent: styles.accent,
} as const;

export function Badge({ tone = 'neutral', children }: BadgeProps) {
  return (
    <span className={`${styles.badge} ${toneClass[tone]}`}>{children}</span>
  );
}
