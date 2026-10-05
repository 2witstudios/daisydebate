import { Icon } from '../../../../components/icon/icon';

/** The hit area: centred on the seam, larger than the tab it shows. */
const base =
  'group absolute top-1/2 flex h-16 w-8 -translate-y-1/2 cursor-pointer items-center justify-center border-0 bg-transparent p-0';

/** Which edge of its column the tab sits on. */
const sides = {
  right: 'left-full -translate-x-1/2',
  left: 'right-full translate-x-1/2',
} as const;

/** One shape at two sizes: small at rest, larger when reached for. */
const tab =
  'flex h-10 w-3 items-center justify-center rounded-md border border-border-strong bg-surface-raised text-ink-muted shadow-1 transition-all duration-120 ease-standard group-hover:h-12 group-hover:w-6 group-hover:text-ink group-hover:shadow-2 group-focus-visible:h-12 group-focus-visible:w-6 group-focus-visible:text-ink group-focus-visible:shadow-2';

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
 * A tab on the seam between a side column and the page, halfway down: it
 * collapses or expands the column it belongs to. It rests small with its
 * chevron showing and grows on hover and focus. Its column must be
 * positioned.
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
      <span className={tab}>
        <Icon
          name={icon}
          size={16}
          className="shrink-0 scale-75 transition-transform duration-120 ease-standard group-hover:scale-100 group-focus-visible:scale-100"
        />
      </span>
    </button>
  );
}
