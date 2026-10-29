import { bloomPetals } from './petal';
import { markGeometry, petalShape, tileGeometry } from './brand-geometry';
import { rasterPalette } from './raster-palette';

/** Same committed geometry as DaisyMark, with explicit fills for Satori. */
export function RasterMark({
  size,
  tile = false,
  scheme = 'light',
}: {
  readonly size: number;
  readonly tile?: boolean;
  readonly scheme?: keyof typeof rasterPalette;
}) {
  const { centre, discRadius, size: drawing } = markGeometry;
  const scale = tile ? tileGeometry.bloomScale : 1;
  const palette = rasterPalette[scheme];
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${drawing} ${drawing}`}
      aria-hidden="true"
    >
      {tile ? (
        <rect
          width={drawing}
          height={drawing}
          rx={tileGeometry.cornerRadius}
          fill={rasterPalette.light.ink}
        />
      ) : null}
      {bloomPetals(petalShape, markGeometry, scale).map(({ d, cardinal }) => (
        <path
          key={d}
          d={d}
          fill={
            tile
              ? rasterPalette.dark.ink
              : cardinal
                ? palette.bloom
                : palette.petal
          }
        />
      ))}
      <circle
        cx={centre}
        cy={centre}
        r={discRadius * scale}
        fill={palette.disc}
      />
    </svg>
  );
}
