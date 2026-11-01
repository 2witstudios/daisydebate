import { RasterMark } from './raster-mark';
import { rasterPalette } from './raster-palette';

export const shareFormats = {
  og: { width: 1200, height: 630, label: 'Open Graph' },
  x: { width: 1600, height: 900, label: 'X' },
  square: { width: 1080, height: 1080, label: 'Instagram square' },
  story: { width: 1080, height: 1920, label: 'Story / Reels / TikTok' },
  youtube: { width: 1280, height: 720, label: 'YouTube thumbnail' },
} as const;

/** The one artwork for served metadata and screenshot exports. */
export function ShareCanvas({
  format,
  scheme = 'light',
}: {
  readonly format: keyof typeof shareFormats;
  readonly scheme?: keyof typeof rasterPalette;
}) {
  const { width, height } = shareFormats[format];
  const palette = rasterPalette[scheme];
  const portrait = height > width;
  const unit = width / 1200;
  const pad = 72 * unit;
  const artSize = (portrait ? 1160 : 700) * unit;
  return (
    <div
      style={{
        display: 'flex',
        position: 'relative',
        overflow: 'hidden',
        width,
        height,
        background: palette.paper,
        color: palette.ink,
        fontFamily: 'Instrument Sans',
        padding: pad,
      }}
    >
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          width: artSize,
          height: artSize,
          right: -artSize * 0.24,
          bottom: -artSize * 0.28,
          opacity: 0.16,
        }}
      >
        <RasterMark size={artSize} scheme={scheme} />
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          width: '100%',
          height: '100%',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 * unit }}>
          <RasterMark size={64 * unit} scheme={scheme} />
          <div
            style={{
              display: 'flex',
              fontFamily: 'Fraunces',
              fontSize: 48 * unit,
              fontWeight: 600,
              letterSpacing: -1.5 * unit,
            }}
          >
            Daisy Debate
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 24 * unit,
            paddingBottom: portrait ? height * 0.24 : 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              fontFamily: 'Fraunces',
              fontSize: (portrait ? 84 : 90) * unit,
              fontWeight: 600,
              lineHeight: 1.03,
              letterSpacing: -3 * unit,
            }}
          >
            <div style={{ display: 'flex' }}>The arena for</div>
            <div style={{ display: 'flex' }}>competitive debate</div>
          </div>
          <div
            style={{
              display: 'flex',
              color: palette.muted,
              fontSize: 26 * unit,
              letterSpacing: 0,
            }}
          >
            Better arguments. A more thoughtful world.
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16 * unit,
            fontSize: 23 * unit,
            color: palette.muted,
          }}
        >
          <div
            style={{
              display: 'flex',
              width: 36 * unit,
              height: 3 * unit,
              background: palette.ink,
            }}
          />
          Think clearly. Debate beautifully.
        </div>
      </div>
    </div>
  );
}
