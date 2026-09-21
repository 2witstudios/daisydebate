import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from '../icon/icon';
import { cn } from '../../cn';

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
      className={cn(
        'inline-flex size-8 cursor-pointer items-center justify-center rounded-sm bg-transparent text-ink-muted transition-colors duration-120 ease-standard hover:bg-surface-overlay hover:text-ink',
        className,
      )}
      {...rest}
    >
      <Icon name={name} size={18} />
    </button>
  );
}
