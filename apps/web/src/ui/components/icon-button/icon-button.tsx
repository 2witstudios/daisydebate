import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from '../icon/icon';
import { cn } from '../../cn';
import { iconButtonClass, type IconButtonTone } from './icon-button-class';

export type IconButtonProps = {
  readonly name: IconName;
  /** Required accessible name — icon buttons have no visible text. */
  readonly label: string;
  readonly tone?: IconButtonTone;
} & ButtonHTMLAttributes<HTMLButtonElement>;

export function IconButton({
  name,
  label,
  tone = 'quiet',
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(iconButtonClass(tone), className)}
      {...rest}
    >
      <Icon name={name} size={18} />
    </button>
  );
}
