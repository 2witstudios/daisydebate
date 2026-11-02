import { shareFormats } from '../../../ui/brand/share-canvas';
import { prose } from '../../ui/prose-class';

export function ShareSheet() {
  return (
    <section aria-label="Share images" className="mt-12 flex flex-col gap-8">
      <div>
        <h2 className={prose.h2}>Share images</h2>
        <p className={prose.p}>
          Exact-size artwork. Scroll each canvas to inspect it, screenshot the
          image element, or open the PNG to save it. Light Open Graph and X
          cards are served on shared links.
        </p>
      </div>
      {Object.entries(shareFormats).map(
        ([format, { width, height, label }]) => (
          <section
            key={format}
            className="flex min-w-0 flex-col gap-4"
            aria-label={label}
          >
            <h3 className="text-lg font-semibold">
              {label} · {width} × {height}
            </h3>
            {(['light', 'dark'] as const).map((scheme) => {
              const src = `/foundation/share/${format}/${scheme}`;
              return (
                <div key={scheme} className="flex min-w-0 flex-col gap-2">
                  <a href={src} className="text-accent underline">
                    Open {scheme} PNG · {width} × {height}
                  </a>
                  <div className="overflow-auto rounded-lg border border-border">
                    {/* Exact raster dimensions are intentional; next/image resizes export artwork. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt={`${label}, ${scheme}: Daisy Debate. The arena for competitive debate. Better arguments. A more thoughtful world.`}
                      width={width}
                      height={height}
                      className="max-w-none"
                      loading="lazy"
                    />
                  </div>
                </div>
              );
            })}
          </section>
        ),
      )}
    </section>
  );
}
