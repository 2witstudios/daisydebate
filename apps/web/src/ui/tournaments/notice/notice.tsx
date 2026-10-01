import type { ReactNode } from 'react';
import { Icon, type IconName } from '../../components/icon/icon';

export type NoticeProps = {
  readonly icon?: IconName;
  readonly children: ReactNode;
};

/** A quiet callout: one icon and a sentence or two. */
export function Notice({ icon = 'alert', children }: NoticeProps) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-surface p-4 text-base text-ink-muted">
      <span className="mt-1 shrink-0 text-accent">
        <Icon name={icon} size={18} />
      </span>
      <p>{children}</p>
    </div>
  );
}
