import type { SVGProps } from 'react';
import { iconPaths, type IconName } from './icons';
import styles from './icon.module.css';

export type IconProps = {
  readonly name: IconName;
  /** Accessible name; omit for decorative icons. */
  readonly label?: string;
  readonly size?: number;
  readonly className?: string | undefined;
} & Omit<SVGProps<SVGSVGElement>, 'name' | 'children'>;

export function Icon({
  name,
  label,
  size = 20,
  className,
  ...rest
}: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={[styles.icon, className].filter(Boolean).join(' ')}
      {...rest}
    >
      {iconPaths[name]}
    </svg>
  );
}

export type { IconName } from './icons';
