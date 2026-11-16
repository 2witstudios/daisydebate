import { cn } from '../../cn';

/** A sample Freestyle draw: Neg strikes first, then the sides alternate. */
const draw = [
  { motion: 'Voting should be mandatory', struck: 'Aff' },
  { motion: 'Social media does more harm than good', struck: 'Neg' },
  { motion: 'This house would ban homework', struck: null },
  { motion: 'Cities should ban cars downtown', struck: 'Aff' },
  { motion: 'College should be free', struck: 'Neg' },
] as const;

/** An illustration of the resolution draw and strike, never a live round. */
export function DrawFigure() {
  return (
    <figure className="m-0 flex flex-col gap-2 rounded-lg bg-surface-sunken p-4">
      <figcaption className="flex flex-wrap justify-between gap-x-3 text-xs font-strong tracking-widest text-ink-muted uppercase">
        <span>Resolution draw</span>
        <span>Neg strikes first</span>
      </figcaption>
      <ul className="flex flex-col gap-1">
        {draw.map(({ motion, struck }) =>
          struck === null ? (
            <li
              key={motion}
              className="flex items-center justify-between gap-3 rounded-md bg-accent px-3 py-2 text-accent-ink"
            >
              <span className="font-display text-md">{motion}</span>
              <span className="shrink-0 rounded-round bg-yolk px-2 py-1 text-xs font-strong text-stage-accent-ink">
                Debating
              </span>
            </li>
          ) : (
            <li
              key={motion}
              className="flex items-center justify-between gap-3 rounded-md bg-surface-raised px-3 py-1"
            >
              <del className="text-sm text-ink-muted">{motion}</del>
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
