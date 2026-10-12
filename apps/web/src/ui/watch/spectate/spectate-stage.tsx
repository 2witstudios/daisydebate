import type { SpectateView } from '../../../features/watch/spectate-view';
import { Tile } from '../../debate-room/stage';
import type { Debater } from '../../debate-room/round';
import { LiveClock } from '../live-clock/live-clock';

type Seat = SpectateView['seats']['aff'];

export type SpectateStageProps = {
  readonly view: SpectateView;
};

const debaterOf = (seat: Seat): Debater => ({
  id: seat.side,
  name: `@${seat.handle}`,
  initials: seat.initials,
  side: seat.side,
  rating: seat.rating,
  bot: null,
});

/** The phase, the motion and the speech clock under the stage. */
function ClockStrip({ view }: SpectateStageProps) {
  const { clock } = view;
  const lost = view.connection === 'reconnecting';
  const clockClass =
    'font-display text-display-sm leading-none tabular-nums max-narrow:text-3xl';
  return (
    <div className="flex items-end gap-5 px-5 py-4 max-narrow:px-3 max-narrow:py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-sm text-stage-ink-muted">
          {clock.kind === 'final' ? 'Final' : clock.phaseName}
        </span>
        <span className="text-sm text-stage-ink-muted">{view.subtitle}</span>
      </div>
      {clock.kind === 'final' ? (
        <div className="flex flex-col items-end gap-1">
          <span className="font-display text-2xl">Ended</span>
          <span className="text-xs text-stage-ink-muted">{`Total speaking time ${clock.totalLabel}`}</span>
        </div>
      ) : lost ? (
        <div className="flex flex-col items-end gap-1">
          <span className={`${clockClass} text-stage-ink-muted`}>--:--</span>
          <span className="text-xs text-stage-ink-muted">
            Last update 12 s ago
          </span>
        </div>
      ) : (
        <LiveClock initialSeconds={clock.secondsLeft} className={clockClass} />
      )}
    </div>
  );
}

/**
 * The speaker large with the other debater inset, as the room's Speaker
 * layout shows them (ADR 0053); once ended, both side by side. Tiles show
 * initials until the delayed spectator media arrives.
 */
export function SpectateStage({ view }: SpectateStageProps) {
  const { aff, neg } = view.seats;
  const speaker = aff.activity === 'Speaking' ? aff : neg;
  const other = speaker === aff ? neg : aff;
  const live = view.live && speaker.activity === 'Speaking';
  return (
    <section
      aria-label="Debaters"
      className="flex flex-col overflow-hidden rounded-xl bg-surface-stage text-stage-ink"
    >
      {live ? (
        <div className="relative flex h-watch-stage max-narrow:grid max-narrow:h-auto max-narrow:grid-cols-2 max-narrow:gap-2 max-narrow:p-2">
          <Tile
            debater={debaterOf(speaker)}
            you={false}
            state="Speaking"
            look="large"
            className="size-full"
          />
          <div className="absolute top-4 right-4 aspect-video w-watch-inset max-narrow:static max-narrow:w-auto">
            <Tile
              debater={debaterOf(other)}
              you={false}
              state=""
              look="small"
              caption
              className="size-full border border-border"
            />
          </div>
        </div>
      ) : (
        <div className="grid h-watch-stage grid-cols-2 gap-2 p-2 max-narrow:h-auto">
          {[aff, neg].map((seat) => (
            <Tile
              key={seat.side}
              debater={debaterOf(seat)}
              you={false}
              state=""
              look="medium"
              className="size-full"
            />
          ))}
        </div>
      )}
      <ClockStrip view={view} />
    </section>
  );
}
