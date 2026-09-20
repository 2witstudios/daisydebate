import type { ReactNode } from 'react';
import styles from './right-rail.module.css';

export type RightRailProps = {
  readonly children: ReactNode;
};

/** Layout-only rail: stacks the dashboard's rail sections with even gaps. */
export function RightRail({ children }: RightRailProps) {
  return <div className={styles.rail}>{children}</div>;
}
