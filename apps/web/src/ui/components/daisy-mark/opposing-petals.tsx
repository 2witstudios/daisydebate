import { cn } from '../../cn';
import { opposingGeometry, petalShape } from '../../brand/brand-geometry';
import { opposingPetals, type PetalShape } from '../../brand/petal';

const { width, height, gap, tilt, scale } = opposingGeometry;

export type OpposingPetalsProps = {
  /** Rendered width; the pair is twice as wide as it is tall. */
  readonly size: number;
  readonly className?: string;
  readonly shape?: PetalShape;
};

/** The debate's two sides: a forest and a sage petal, tip to tip. */
export function OpposingPetals({
  size,
  className,
  shape = petalShape,
}: OpposingPetalsProps) {
  const [left, right] = opposingPetals(shape, {
    centre: [width / 2, height / 2],
    gap,
    tilt,
    scale,
  });
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={size}
      height={(size * height) / width}
      aria-hidden="true"
      className={cn('shrink-0', className)}
    >
      <path d={left} className="fill-forest" />
      <path d={right} className="fill-sage" />
    </svg>
  );
}
