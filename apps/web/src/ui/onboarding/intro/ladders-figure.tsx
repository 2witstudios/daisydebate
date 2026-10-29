const ladders = [
  {
    name: 'Freestyle',
    rows: [
      ['Sam', 1560],
      ['Priya', 1502],
      ['You', 1447],
      ['Mei', 1389],
    ],
  },
  {
    name: 'Policy',
    rows: [
      ['Alex', 1531],
      ['Dana', 1476],
      ['Noor', 1402],
    ],
  },
  {
    name: 'Value',
    rows: [
      ['Kim', 1518],
      ['Ash', 1464],
      ['Lena', 1395],
    ],
  },
] as const;

/** An illustration of the three separate ladders, never a live standings read. */
export function LaddersFigure() {
  return (
    <figure
      className="rounded-lg bg-surface-sunken p-5"
      aria-label="Illustration of the three rating ladders"
    >
      <figcaption className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs font-strong tracking-widest text-ink-muted uppercase">
          Three ladders
        </span>
        <span className="rounded-round border border-border bg-surface-raised px-3 py-1 text-xs font-strong text-ink">
          Season 1
        </span>
      </figcaption>
      <div className="grid grid-cols-3 gap-4 max-narrow:grid-cols-1">
        {ladders.map(({ name, rows }) => (
          <div key={name} className="flex min-w-0 flex-col gap-2">
            <h2 className="text-sm font-strong text-ink">{name}</h2>
            <ol className="flex flex-col gap-1">
              {rows.map(([person, rating]) => (
                <li
                  key={person}
                  className={`flex items-center justify-between gap-2 rounded-sm border px-3 py-1 text-sm ${person === 'You' ? 'border-yolk bg-yolk/30 font-strong text-ink' : 'border-border bg-surface-raised text-ink-muted'}`}
                >
                  <span>{person}</span>
                  <span className="font-strong text-ink tabular-nums">
                    {rating}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </figure>
  );
}
