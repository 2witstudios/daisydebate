import type { SeatMedia } from './stage-subscriptions';

type StageSeat = {
  readonly side: 'affirmative' | 'negative';
  readonly label: string;
  readonly kind: 'human' | 'bot';
  readonly identity: string | null;
  readonly floor: boolean;
};
export type StageSnapshot = {
  readonly phase: 'speech' | 'prep' | 'judging' | 'between' | 'slate';
  readonly clock: { readonly label: string; readonly endsAt: string } | null;
  readonly seats: readonly StageSeat[];
};
/** Whether the page holds the room; a rotation or a drop shows as a gap, not a freeze. */
export type StageLink = 'connected' | 'reconnecting';

const slateCopy: Record<Exclude<StageSnapshot['phase'], 'speech'>, string> = {
  prep: 'Preparation',
  judging: 'Judges are deciding',
  between: 'Next speech soon',
  slate: 'Starting soon',
};

const seatCopy: Record<Exclude<SeatMedia, 'video'>, string> = {
  'camera-off': 'Camera off',
  'voice-only': 'AI debater, voice only',
  away: 'Not connected',
};

const remaining = (endsAt: string, nowMs: number) => {
  const total = Math.max(0, Math.ceil((Date.parse(endsAt) - nowMs) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/**
 * Everything the audience's video shows, burned in so it cannot drift from the
 * media. Each seat owns one tile with its name beneath it, so a tile cannot sit
 * above the wrong name. Names and the branding bar sit outside the tiles and
 * never cover a debater, because this video is also the official feed for streamers.
 */
export function StageView(props: {
  readonly snapshot: StageSnapshot;
  readonly nowMs: number;
  readonly siteLink: string;
  readonly link: StageLink;
  readonly mediaOf: (seat: StageSeat) => SeatMedia;
  readonly tile: (seat: StageSeat) => React.ReactNode;
}) {
  const { snapshot } = props;
  const live = snapshot.phase === 'speech';
  const gap = live && props.link === 'reconnecting';
  return (
    <main className="broadcast-stage">
      <header className="broadcast-stage-clock">
        <span>
          {live
            ? snapshot.clock?.label
            : slateCopy[snapshot.phase as keyof typeof slateCopy]}
        </span>
        {gap ? <span>Reconnecting to the debate</span> : null}
        {snapshot.clock ? (
          <strong>{remaining(snapshot.clock.endsAt, props.nowMs)}</strong>
        ) : null}
      </header>
      <ul className="broadcast-stage-seats">
        {snapshot.seats.map((seat) => {
          const media = props.mediaOf(seat);
          return (
            <li key={`${seat.side}-${seat.label}`} data-floor={seat.floor}>
              <div
                className={`broadcast-stage-tile ${live && !gap ? 'visible' : 'invisible'}`}
              >
                {media === 'video' ? props.tile(seat) : seatCopy[media]}
              </div>
              <p>
                {seat.label}
                {seat.floor ? ' · speaking' : ''}
              </p>
            </li>
          );
        })}
      </ul>
      <footer className="broadcast-stage-brand">
        <span>Daisy Debate</span>
        <span>{props.siteLink}</span>
      </footer>
    </main>
  );
}
