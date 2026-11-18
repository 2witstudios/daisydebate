import type { ReactNode } from 'react';
import { cn } from '../../cn';

/** The quiet uppercase label over a group of rows. */
export const eyebrowClass =
  'text-xs font-heavy tracking-wider text-ink-muted uppercase';

/** A bordered card of rows, as the Lobby's room list draws them. */
export function ListCard({
  label,
  className,
  children,
}: {
  readonly label?: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        'overflow-hidden rounded-lg border border-border bg-surface-raised',
        className,
      )}
    >
      {children}
    </section>
  );
}

/** A heading band inside a list card. */
export function ListHeading({ children }: { readonly children: ReactNode }) {
  return (
    <h2
      className={cn(
        'border-b border-border bg-surface px-4 py-2',
        eyebrowClass,
      )}
    >
      {children}
    </h2>
  );
}

/** One row: what it is on the left, its state or one action on the right. */
export function ListRow({
  title,
  facts,
  detail,
  trailing,
  tone = 'plain',
  current = false,
}: {
  readonly title: ReactNode;
  /** Quiet text on the title's own line. */
  readonly facts?: ReactNode;
  readonly detail?: ReactNode;
  readonly trailing?: ReactNode;
  readonly tone?: 'plain' | 'selected' | 'held';
  readonly current?: boolean;
}) {
  return (
    <li
      aria-current={current ? 'true' : undefined}
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3 last:border-b-0',
        tone === 'selected' && 'bg-surface-sunken',
        tone === 'held' && 'bg-hue-teal-soft',
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="min-w-0">
          <strong className="font-strong">{title}</strong>
          {facts ? <span className="text-ink-muted"> · {facts}</span> : null}
        </p>
        {detail ? <div className="text-sm text-ink-muted">{detail}</div> : null}
      </div>
      {trailing}
    </li>
  );
}
