import type { PublishedResolution } from '@daisy/protocol';
import {
  seasonsCardClass,
  seasonsEyebrowClass,
} from '../seasons-page/seasons-class';

const kindLabel: Readonly<Record<PublishedResolution['kind'], string>> = {
  policy: 'Policy',
  value: 'Value',
};

/**
 * The resolutions published now, which Formats owns (ADR 0092). The edition
 * stays out: beside a season picker it would read as the rating season.
 */
export function PublishedResolutions({
  resolutions,
}: {
  readonly resolutions: readonly PublishedResolution[];
}) {
  if (resolutions.length === 0) return null;
  return (
    <section
      aria-labelledby="published-resolutions"
      className={seasonsCardClass}
    >
      <h2 id="published-resolutions" className="text-lg font-bold">
        Resolutions
      </h2>
      <ul className="grid grid-cols-2 gap-4 max-compact:grid-cols-1">
        {resolutions.map((resolution) => (
          <li key={resolution.id} className="flex min-w-0 flex-col gap-1">
            <span className={seasonsEyebrowClass}>
              {kindLabel[resolution.kind]}
            </span>
            <p className="font-strong">{resolution.text}</p>
            {resolution.theme ? (
              <span className="text-sm text-ink-muted">{resolution.theme}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
