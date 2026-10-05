import { Icon } from '../../../../components/icon/icon';

const base =
  'absolute top-3 flex h-10 w-5 cursor-pointer items-center justify-center border border-border bg-surface text-ink-muted shadow-1 transition-all duration-120 ease-standard hover:w-8 hover:text-ink hover:shadow-2 focus-visible:w-8 focus-visible:text-ink';

/** Which edge of its column the tab hangs from. */
const sides = {
  right: 'left-full -ml-px rounded-r-md border-l-0',
  left: 'right-full -mr-px rounded-l-md border-r-0',
} as const;

export type EdgeTabProps = {
  readonly side: keyof typeof sides;
  readonly label: string;
  readonly expanded: boolean;
  /** The chevron: it points the way the column moves when pressed. */
  readonly icon: 'chevronLeft' | 'chevronRight';
  readonly onClick: () => void;
  readonly controls?: string;
  readonly className?: string;
};

/**
 * A pull tab hanging off a side column's inner edge, level with its header:
 * it collapses or expands the column it belongs to, and grows on hover and
 * focus. Its column must be positioned.
 */
export function EdgeTab({
  side,
  label,
  expanded,
  icon,
  onClick,
  controls,
  className = '',
}: EdgeTabProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onClick}
      className={`${base} ${sides[side]} ${className}`}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}
