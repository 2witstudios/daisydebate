import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icon/icon';

export type PanelProps = {
  readonly title: ReactNode;
  readonly icon?: IconName;
  /** Trailing header action, e.g. a "See all" ghost button. */
  readonly action?: ReactNode;
  readonly children: ReactNode;
};

export function Panel({ title, icon, action, children }: PanelProps) {
  return (
    <section className={'rounded-md border border-border bg-surface p-5'}>
      <header className={'mb-4 flex items-center gap-2 text-ink'}>
        {icon ? (
          <span className={'inline-flex text-accent'}>
            <Icon name={icon} size={17} />
          </span>
        ) : null}
        <h2 className={'text-md leading-tight font-heavy tracking-tight'}>
          {title}
        </h2>
        {action ? <div className={'ml-auto'}>{action}</div> : null}
      </header>
      {children}
    </section>
  );
}
