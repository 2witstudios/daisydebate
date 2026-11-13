import type {
  StageSeatView,
  StageSnapshot,
} from '../../features/stage-capture/stage-access';
import { formatCountdown } from '../../lib/clock-display';
import { Icon } from '../components/icon/icon';
import { StageFooter } from './stage-footer';
import { StageSeat } from './stage-seat';
import { StageSlate } from './stage-slate';
import type { SeatMedia } from './stage-subscriptions';

/** Whether the page holds the room; a rotation or a drop shows as a gap, not a freeze. */
export type StageLink = 'connected' | 'reconnecting';

/**
 * Everything the audience's video shows, burned in so it cannot drift from the
 * media. Each seat owns one tile with its name beneath it, and the tiles keep their
 * place under a slate so a camera is already attached when the next speech opens.
 * Names and the branding bar sit outside the tiles and never cover a debater,
 * because this video is also the official feed for streamers.
 */
export function StageView(props: {
  readonly snapshot: StageSnapshot;
  readonly nowMs: number;
  readonly siteLink: string;
  readonly link: StageLink;
  readonly mediaOf: (seat: StageSeatView) => SeatMedia;
  readonly tile: (seat: StageSeatView) => React.ReactNode;
}) {
  const { snapshot } = props;
  const speech = snapshot.phase === 'speech' ? snapshot : null;
  const gap = speech !== null && props.link === 'reconnecting';
  return (
    <div className="broadcast-stage">
      <header className="broadcast-stage-clock">
        {speech ? (
          <>
            <span>{speech.clock.label}</span>
            <strong>
              {formatCountdown(Date.parse(speech.clock.endsAt) - props.nowMs)}
            </strong>
          </>
        ) : null}
      </header>
      <ul className="broadcast-stage-seats">
        {snapshot.seats.map((seat) => (
          <StageSeat
            key={`${seat.side}-${seat.label}`}
            seat={seat}
            media={props.mediaOf(seat)}
            shown={speech !== null && !gap}
            tile={props.tile(seat)}
          />
        ))}
      </ul>
      {gap ? (
        <p className="broadcast-stage-notice">
          <span>
            <Icon name="refresh" size={22} />
            Reconnecting to the debate
          </span>
        </p>
      ) : null}
      {snapshot.phase === 'speech' ? null : <StageSlate snapshot={snapshot} />}
      <StageFooter siteLink={props.siteLink} />
    </div>
  );
}
