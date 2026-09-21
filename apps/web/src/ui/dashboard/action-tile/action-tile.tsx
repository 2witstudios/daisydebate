import Link from 'next/link';
import type { ReactNode } from 'react';
import type { IconName } from '../../components/icon/icon';
import { Icon } from '../../components/icon/icon';
import { StatusLine } from '../../components/status-line/status-line';
import styles from './action-tile.module.css';

type ActionTileTint = 'accent' | 'gold' | 'neutral';

export type ActionTileProps = {
  readonly href: string;
  /** Icon name from the shared stroke icon set. */
  readonly glyph: IconName;
  readonly title: string;
  readonly description: string;
  /** Icon tint; defaults to neutral. */
  readonly tint?: ActionTileTint;
  readonly status?: {
    readonly tone: 'online' | 'live' | 'neutral';
    readonly text: ReactNode;
  };
};

export function ActionTile({
  href,
  glyph,
  title,
  description,
  tint = 'neutral',
  status,
}: ActionTileProps) {
  const tintClass =
    tint === 'accent'
      ? styles.accent
      : tint === 'gold'
        ? styles.gold
        : styles.neutral;
  return (
    <Link href={href} className={styles.tile}>
      <Icon
        name={glyph}
        size={40}
        strokeWidth={1.6}
        className={`${styles.glyph} ${tintClass}`}
      />
      <div className={styles.body}>
        <h3 className={styles.title}>{title}</h3>
        <p className={styles.description}>{description}</p>
      </div>
      <div className={styles.footer}>
        {status ? (
          <StatusLine tone={status.tone}>{status.text}</StatusLine>
        ) : (
          <span />
        )}
        <span className={styles.chevron} aria-hidden="true">
          ›
        </span>
      </div>
    </Link>
  );
}
