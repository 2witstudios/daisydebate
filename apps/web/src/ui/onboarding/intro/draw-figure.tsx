import { cn } from '../../cn';

/** A sample Freestyle draw: Neg strikes first, then the sides alternate. */
const draw = [
  { resolution: 'Voting should be mandatory', struck: 'Aff' },
  { resolution: 'Social media does more harm than good', struck: 'Neg' },
  { resolution: 'Homework should be banned', struck: null },
  { resolution: 'Cities should ban cars downtown', struck: 'Aff' },
  { resolution: 'College should be free', struck: 'Neg' },
] as const;

/** An example of steps 1 and 2, the resolution draw and strike, never a live round. */
export function DrawFigure() {
  return (
    <figure className="m-0 flex flex-col gap-2 rounded-lg bg-surface-sunken p-4">
      <figcaption className="flex flex-wrap justify-between gap-x-3 text-xs font-strong tracking-widest text-ink-muted uppercase">
        <span>Steps 1 and 2, as you’ll see them</span>
        <span>Example draw</span>
      </figcaption>
      <ul className="flex flex-col gap-1">
        {draw.map(({ resolution, struck }) =>
          struck === null ? (
            <li
              key={resolution}
              className="flex items-center justify-between gap-3 rounded-md bg-accent px-3 py-2 text-accent-ink"
            >
              <span className="font-display text-md">{resolution}</span>
              <span className="shrink-0 rounded-round bg-yolk px-2 py-1 text-xs font-strong text-stage-accent-ink">
                Debating
              </span>
            </li>
          ) : (
            <li
              key={resolution}
              className="flex items-center justify-between gap-3 rounded-md bg-surface-raised px-3 py-1"
            >
              <del className="text-sm text-ink-muted">{resolution}</del>
              <span
                className={cn(
                  'shrink-0 text-xs font-strong',
                  struck === 'Aff' ? 'text-accent' : 'text-hue-clay',
                )}
              >
                {`${struck} struck`}
              </span>
            </li>
          ),
        )}
      </ul>
    </figure>
  );
}
