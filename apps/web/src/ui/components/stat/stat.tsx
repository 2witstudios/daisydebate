import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icon/icon';
import styles from './stat.module.css';

export type StatProps = {
  readonly value: ReactNode;
  readonly icon?: IconName;
  readonly label?: string;
};

export function Stat({ value, icon, label }: StatProps) {
  return (
    <span className={styles.stat}>
      {icon ? <Icon name={icon} size={14} /> : null}
      <span className={styles.value}>{value}</span>
      {label ? <span className={styles.label}>{label}</span> : null}
    </span>
  );
}
