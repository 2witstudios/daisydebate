import type { Bloom } from '../../../features/leaderboard/bloom';
import { bloomPetalShapes } from './bloom-glyph-geometry';

export type BloomGlyphProps = {
  readonly bloom: Bloom;
  readonly size?: number;
};

/**
 * The band as a flower: filled petals grow with the band. A provisional
 * debater gets a dashed ring instead. Decorative: the band is always named
 * in text beside it.
 */
export function BloomGlyph({ bloom, size = 24 }: BloomGlyphProps) {
  return (
    <svg
      viewBox="0 0 28 28"
      width={size}
      height={size}
      aria-hidden="true"
      className="block shrink-0"
    >
      {bloom === 'provisional' ? (
        <>
          <circle
            cx="14"
            cy="14"
            r="10.5"
            fill="none"
            strokeWidth="1.6"
            strokeDasharray="3 3"
            className="stroke-ink-faint"
          />
          <circle cx="14" cy="14" r="3" className="fill-ink-faint" />
        </>
      ) : (
        <>
          {bloomPetalShapes(bloom).map((petal) => (
            <ellipse
              key={petal.angle}
              cx={petal.cx}
              cy={petal.cy}
              rx="2.5"
              ry="4.6"
              transform={`rotate(${petal.angle} ${petal.cx} ${petal.cy})`}
              strokeWidth="1.1"
              className={
                petal.filled ? 'fill-accent' : 'fill-none stroke-ink-faint'
              }
            />
          ))}
          <circle cx="14" cy="14" r="3.2" className="fill-yolk" />
        </>
      )}
    </svg>
  );
}
