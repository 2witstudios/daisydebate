import type { SpectateView } from '../../../features/watch/spectate-view';
import { Badge } from '../../components/badge/badge';
import { InertButton } from '../inert-button/inert-button';
import { LiveClock } from '../live-clock/live-clock';

export type MatchupProps = {
  readonly view: SpectateView;
};

function Seat({ seat }: { seat: SpectateView['seats']['aff'] }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 rounded-lg border border-border bg-surface p-4 shadow-1 max-compact:w-full">
      <div className="flex items-center gap-2">
        <span className="text-2xs font-bold tracking-wider text-ink-faint uppercase">
          {seat.label}
        </span>
        {seat.activity ? (
          <Badge tone={seat.activity === 'Speaking' ? 'live' : 'neutral'}>
            {seat.activity}
          </Badge>
        ) : null}
      </div>
      <span className="truncate text-lg font-bold text-ink">{`@${seat.handle}`}</span>
      <span className="text-sm text-ink-muted tabular-nums">
        {`${seat.rating} · ${seat.standing}`}
      </span>
      <InertButton action="follow" className="self-start">
        Follow
      </InertButton>
    </div>
  );
}

function Clock({ clock }: { clock: SpectateView['clock'] }) {
  if (clock.kind === 'final')
    return (
      <div className="flex flex-col items-center gap-1 px-4 text-center">
        <span className="text-sm text-ink-muted">Final</span>
        <span className="font-display text-2xl font-bold text-ink">Ended</span>
        <span className="text-xs text-ink-faint">{`Total speaking time ${clock.totalLabel}`}</span>
      </div>
    );
  return (
    <div className="flex flex-col items-center gap-1 px-4 text-center">
      <span className="text-sm text-ink-muted">{clock.phaseName}</span>
      <LiveClock
        initialSeconds={clock.secondsLeft}
        className="font-display text-3xl font-bold text-ink tabular-nums"
      />
      <span className="text-sm text-ink-muted">{`${clock.speaker} speaking`}</span>
      <span className="text-xs text-ink-faint">{`Delayed ${clock.delaySeconds} s`}</span>
    </div>
  );
}

/** Both seats around the speech clock; while reconnecting the clock is unknown. */
export function Matchup({ view }: MatchupProps) {
  return (
    <div className="flex items-stretch gap-4 max-compact:flex-col">
      <Seat seat={view.seats.aff} />
      {view.connection === 'reconnecting' && view.clock.kind === 'running' ? (
        <div className="flex flex-col items-center justify-center gap-1 px-4 text-center">
          <span className="text-sm text-ink-muted">{view.clock.phaseName}</span>
          <span className="font-display text-3xl font-bold text-ink-faint">
            --:--
          </span>
          <span className="text-xs text-ink-faint">Last update 12 s ago</span>
        </div>
      ) : (
        <Clock clock={view.clock} />
      )}
      <Seat seat={view.seats.neg} />
    </div>
  );
}
