import { cn } from '../../cn';

const petalAngles = [0, 45, 90, 135, 180, 225, 270, 315] as const;

export type DaisyMarkProps = {
  readonly size: number;
  readonly className?: string;
  /** Fill of the centre disc; the petals always take currentColor. */
  readonly discClassName?: string;
};

/** The Daisy mark: eight petals around a solid disc. Filled, not stroked. */
export function DaisyMark({
  size,
  className,
  discClassName = 'fill-current',
}: DaisyMarkProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      className={cn('shrink-0', className)}
    >
      <g className="fill-current">
        {petalAngles.map((angle) => (
          <ellipse
            key={angle}
            cx="12"
            cy="5.1"
            rx="2.3"
            ry="3.9"
            transform={`rotate(${angle} 12 12)`}
          />
        ))}
      </g>
      <circle cx="12" cy="12" r="2.4" className={discClassName} />
    </svg>
  );
}

/** The mark on its accent tile, as it sits beside the wordmark. */
export function DaisyLogo() {
  return (
    <span
      className="inline-flex size-shell-logo items-center justify-center rounded-sm bg-accent text-accent-ink"
      aria-hidden="true"
    >
      <DaisyMark size={18} />
    </span>
  );
}
