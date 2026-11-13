import type { StageSeatView } from '../../features/stage-capture/stage-access';
import { Icon } from '../components/icon/icon';
import type { SeatMedia } from './stage-subscriptions';

const sideCopy: Record<StageSeatView['side'], string> = {
  affirmative: 'Affirmative',
  negative: 'Negative',
};

/** What a tile says in place of a camera. */
function SeatState({ media }: { readonly media: Exclude<SeatMedia, 'video'> }) {
  switch (media) {
    case 'camera-off':
      return (
        <>
          <Icon name="camera-off" size={56} />
          Camera off
        </>
      );
    case 'voice-only':
      return (
        <>
          <Icon name="wave" size={72} />
          AI debater, voice only
        </>
      );
    case 'away':
      return <>Not connected</>;
  }
}

/**
 * One seat: its tile, then its own name and side beneath, so a tile cannot sit above
 * the wrong name and no name sits on a debater. The floor is marked three ways
 * (ring, weight, word), never by colour alone.
 */
export function StageSeat(props: {
  readonly seat: StageSeatView;
  readonly media: SeatMedia;
  /** False on a slate or a gap: the tile keeps its place and shows nothing. */
  readonly shown: boolean;
  readonly tile: React.ReactNode;
}) {
  const { seat, media } = props;
  return (
    <li>
      <div
        className={`broadcast-stage-tile ${props.shown ? 'visible' : 'invisible'}`}
        data-media={media}
        data-floor={seat.floor}
      >
        {media === 'video' ? props.tile : <SeatState media={media} />}
      </div>
      <div className="broadcast-stage-name" data-floor={seat.floor}>
        <div>
          {seat.floor ? <Icon name="wave" size={18} /> : null}
          <p>{seat.label}</p>
          {seat.floor ? <em>Speaking</em> : null}
        </div>
        <span>{sideCopy[seat.side]}</span>
      </div>
    </li>
  );
}
