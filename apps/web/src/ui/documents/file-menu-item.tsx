import { Button } from '../components/button/button';
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../components/icon/icon';

const itemClass =
  'min-h-dense-target w-full gap-2 rounded-sm px-2 text-sm text-ink no-underline hover:bg-surface-overlay hover:no-underline';
const dangerClass = `${itemClass} text-live`;

export function FileMenuItem({
  icon,
  danger = false,
  onClick,
  children,
  disabled = false,
  initialFocus = false,
}: {
  readonly initialFocus?: boolean;
  readonly disabled?: boolean;
  readonly icon?: IconName;
  readonly danger?: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Button
      variant="row"
      type="button"
      disabled={disabled}
      role="menuitem"
      data-menu-initial-focus={initialFocus || undefined}
      onKeyDown={(event) => {
        if (event.repeat && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
        }
      }}
      className={danger ? dangerClass : itemClass}
      onClick={(event) => {
        if (event.detail <= 1) onClick();
      }}
    >
      {icon ? <Icon name={icon} size={14} /> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </Button>
  );
}
