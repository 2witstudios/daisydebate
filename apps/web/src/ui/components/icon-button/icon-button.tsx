import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from '../icon/icon';
import styles from './icon-button.module.css';

export type IconButtonProps = {
  readonly name: IconName;
  /** Required accessible name — icon buttons have no visible text. */
  readonly label: string;
} & ButtonHTMLAttributes<HTMLButtonElement>;

export function IconButton({
  name,
  label,
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={[styles.iconButton, className].filter(Boolean).join(' ')}
      {...rest}
    >
      <Icon name={name} size={18} />
    </button>
  );
}
