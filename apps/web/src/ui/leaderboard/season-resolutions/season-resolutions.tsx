import type { PublishedResolution } from '@daisy/protocol';

const kindLabel: Readonly<Record<PublishedResolution['kind'], string>> = {
  policy: 'Policy',
  value: 'Value',
};

/**
 * The resolutions published now. Formats owns them and they carry no link to
 * a rating season (ADR 0092), so a closed season never shows them as its own.
 */
export function SeasonResolutions({
  resolutions,
}: {
  readonly resolutions: readonly PublishedResolution[];
}) {
  if (resolutions.length === 0) return null;
  return (
    <section
      aria-labelledby="season-resolutions"
      className="flex flex-col gap-3 rounded-lg bg-surface p-5 shadow-1"
    >
      <h2 id="season-resolutions" className="text-lg font-bold">
        Resolutions
      </h2>
      <ul className="grid grid-cols-2 gap-4 max-compact:grid-cols-1">
        {resolutions.map((resolution) => (
          <li key={resolution.id} className="flex min-w-0 flex-col gap-1">
            <span className="text-2xs font-bold tracking-wider text-ink-faint uppercase">
              {kindLabel[resolution.kind]}
              {resolution.edition ? ` · ${resolution.edition}` : null}
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
