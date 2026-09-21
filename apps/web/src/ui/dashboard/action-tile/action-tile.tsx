import Link from 'next/link';
import type { ReactNode } from 'react';
import type { IconName } from '../../components/icon/icon';
import { Icon } from '../../components/icon/icon';
import { StatusLine } from '../../components/status-line/status-line';
import type { ActionTileTint } from './action-tile-class';
import { actionTileTintClass } from './action-tile-class';

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
  return (
    <Link
      href={href}
      className="group flex h-full flex-col gap-3 rounded-md border border-border bg-surface p-5 text-ink no-underline transition duration-140 ease-standard hover:border-border-strong hover:bg-surface-raised"
    >
      <Icon
        name={glyph}
        size={40}
        strokeWidth={1.6}
        className={actionTileTintClass(tint)}
      />
      <div className="flex flex-1 flex-col gap-1">
        <h3 className="text-xl leading-tile-title font-heavy tracking-tight">
          {title}
        </h3>
        <p className="line-clamp-2 text-base leading-tile-copy text-ink-muted">
          {description}
        </p>
      </div>
      <div className="flex min-h-tile-footer-min items-center justify-between gap-3">
        {status ? (
          <StatusLine tone={status.tone}>{status.text}</StatusLine>
        ) : (
          <span />
        )}
        <span
          className="text-xl leading-none text-ink-faint transition duration-140 ease-standard group-hover:translate-x-tile-nudge group-hover:text-ink"
          aria-hidden="true"
        >
          ›
        </span>
      </div>
    </Link>
  );
}
