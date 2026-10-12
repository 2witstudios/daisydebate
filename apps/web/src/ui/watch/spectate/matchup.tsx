import type { SpectateView } from '../../../features/watch/spectate-view';
import { liveHref } from '../../../features/watch/routes';
import { cn } from '../../cn';
import { CopyLink } from '../copy-link/copy-link';
import { InertButton } from '../inert-button/inert-button';

export type MatchupProps = {
  readonly view: SpectateView;
};

const disc = { aff: 'bg-hue-sky', neg: 'bg-hue-clay' } as const;

function Seat({ seat }: { seat: SpectateView['seats']['aff'] }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        aria-hidden="true"
        className={cn(
          'flex size-room-target shrink-0 items-center justify-center rounded-round text-sm font-strong text-background',
          disc[seat.side],
        )}
      >
        {seat.initials}
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-strong text-ink">{`@${seat.handle}`}</span>
        <span className="text-xs text-ink-faint tabular-nums">
          {`${seat.label} · ${seat.rating} · ${seat.standing}`}
        </span>
      </div>
    </div>
  );
}

/** Both debaters with their ratings, then Follow both and Share. */
export function Matchup({ view }: MatchupProps) {
  return (
    <div className="flex flex-wrap items-center gap-4 max-narrow:gap-3">
      <Seat seat={view.seats.aff} />
      <span className="text-ink-faint">vs</span>
      <Seat seat={view.seats.neg} />
      <div className="ml-auto flex items-center gap-2">
        <InertButton action="follow">Follow both</InertButton>
        <CopyLink path={liveHref(view.id)} />
      </div>
    </div>
  );
}
