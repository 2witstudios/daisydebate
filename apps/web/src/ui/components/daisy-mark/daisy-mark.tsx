import { cn } from '../../cn';
import {
  markGeometry,
  petalShape,
  tileGeometry,
} from '../../brand/brand-geometry';
import { bloomPetals, type PetalShape } from '../../brand/petal';
import { markFills, type DaisyMarkVariant } from './daisy-mark-class';

const { size: drawing, centre, discRadius } = markGeometry;

/** The eight petals around the centre, scaled about it. */
const petalsOf = (shape: PetalShape, scale = 1) =>
  bloomPetals(shape, markGeometry, scale);

export type DaisyMarkProps = {
  readonly size: number;
  readonly variant: DaisyMarkVariant;
  readonly className?: string;
  /** A preview shape for the brand sheet; everything else ships the committed one. */
  readonly shape?: PetalShape;
};

/**
 * The Daisy mark: eight teardrop petals around a disc (ADR 0045).
 * `primary` sits on the page in either scheme, `mono` takes currentColor,
 * and `reverse` sits on forest.
 */
export function DaisyMark({
  size,
  variant,
  className,
  shape = petalShape,
}: DaisyMarkProps) {
  const fills = markFills[variant];
  return (
    <svg
      viewBox={`0 0 ${drawing} ${drawing}`}
      width={size}
      height={size}
      aria-hidden="true"
      className={cn('shrink-0', className)}
    >
      {petalsOf(shape).map(({ d, cardinal }) => (
        <path
          key={d}
          d={d}
          className={cardinal ? fills.cardinal : fills.diagonal}
        />
      ))}
      <circle cx={centre} cy={centre} r={discRadius} className={fills.disc} />
    </svg>
  );
}

export type DaisyTileProps = {
  readonly size: number;
  readonly className?: string;
  readonly shape?: PetalShape;
};

/** The favicon tile: a reverse bloom on a forest rounded square. */
export function DaisyTile({
  size,
  className,
  shape = petalShape,
}: DaisyTileProps) {
  const { cornerRadius, bloomScale } = tileGeometry;
  return (
    <svg
      viewBox={`0 0 ${drawing} ${drawing}`}
      width={size}
      height={size}
      aria-hidden="true"
      className={cn('shrink-0', className)}
    >
      <rect
        width={drawing}
        height={drawing}
        rx={cornerRadius}
        className="fill-surface-stage"
      />
      {petalsOf(shape, bloomScale).map(({ d }) => (
        <path key={d} d={d} className={markFills.reverse.cardinal} />
      ))}
      <circle
        cx={centre}
        cy={centre}
        r={discRadius * bloomScale}
        className={markFills.reverse.disc}
      />
    </svg>
  );
}

/** The mark as it sits beside the wordmark: the primary bloom, no tile. */
export function DaisyLogo() {
  return <DaisyMark size={34} variant="primary" className="size-shell-logo" />;
}
