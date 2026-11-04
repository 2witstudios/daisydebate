import type { ReactNode, MouseEventHandler, KeyboardEventHandler } from 'react';
import { Icon, type IconName } from '../components/icon/icon';

const itemClass =
  'flex min-h-dense-target w-full cursor-pointer items-center gap-2 rounded-sm px-2 text-left text-sm text-ink no-underline hover:bg-surface-overlay hover:no-underline';
const dangerClass = `${itemClass} text-live`;

export function FileMenuItem({
  icon,
  danger = false,
  onClick,
  children,
  disabled = false,
  initialFocus = false,
  onKeyDown,
}: {
  readonly initialFocus?: boolean;
  readonly onKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
  readonly disabled?: boolean;
  readonly icon?: IconName;
  readonly danger?: boolean;
  readonly onClick: MouseEventHandler<HTMLButtonElement>;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      role="menuitem"
      data-menu-initial-focus={initialFocus || undefined}
      onKeyDown={onKeyDown}
      className={danger ? dangerClass : itemClass}
      onClick={onClick}
    >
      {icon ? <Icon name={icon} size={14} /> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}
