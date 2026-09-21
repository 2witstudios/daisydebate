import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icon/icon';
import styles from './panel.module.css';

export type PanelProps = {
  readonly title: ReactNode;
  readonly icon?: IconName;
  /** Trailing header action, e.g. a "See all" ghost button. */
  readonly action?: ReactNode;
  readonly children: ReactNode;
};

export function Panel({ title, icon, action, children }: PanelProps) {
  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        {icon ? (
          <span className={styles.icon}>
            <Icon name={icon} size={17} />
          </span>
        ) : null}
        <h2 className={styles.title}>{title}</h2>
        {action ? <div className={styles.action}>{action}</div> : null}
      </header>
      {children}
    </section>
  );
}
