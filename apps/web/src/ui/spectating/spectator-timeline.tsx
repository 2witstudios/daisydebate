import { pointsTotal, seatKey, type SpectatorTimeline } from '@daisy/protocol';
import { sideName } from '../../features/debate-room/seat-names';
import { formatCountdown } from '../../lib/clock-display';
import {
  resultSentence,
  seatLabelIn,
  stageSentence,
} from './spectator-timeline-copy';

type Ballot = NonNullable<SpectatorTimeline['result']>['ballots'][number];

/** "Affirmative 34, Negative 31": sides in declared order, then any other subject. */
const scoresLine = (sides: SpectatorTimeline['sides'], ballot: Ballot) => {
  const keys = sides.map((side) => side.key);
  return [
    ...keys.filter((key) => key in ballot.scores),
    ...Object.keys(ballot.scores).filter((key) => !keys.includes(key)),
  ]
    .map(
      (key) =>
        `${sideName(sides, key)} ${pointsTotal(ballot.scores[key] ?? 0)}`,
    )
    .join(', ');
};

/** The released facts as text: what the video shows, for anyone who cannot see it. */
export function SpectatorFacts({
  timeline,
}: {
  readonly timeline: SpectatorTimeline;
}) {
  const { result } = timeline;
  return (
    <section aria-label="Round facts" className="grid gap-4">
      <h1 className="font-display text-2xl font-bold tracking-tight">
        {timeline.resolution ?? 'Debate'}
      </h1>
      <ul className="text-base text-ink">
        {timeline.seats.map((seat) => (
          <li key={seatKey(seat.seat)}>
            {seatLabelIn(timeline, seat.seat)}:{' '}
            {seat.label ?? 'Unnamed debater'}
          </li>
        ))}
      </ul>
      <p aria-live="polite" className="text-base text-ink-muted">
        {stageSentence(timeline, timeline.stage)}
      </p>
      {timeline.stage.kind === 'floor' ? (
        <p role="timer" className="font-display text-xl font-bold tabular-nums">
          {`${formatCountdown(timeline.stage.remainingMs)} left`}
        </p>
      ) : null}
      {result ? (
        <div aria-live="polite">
          <p>{resultSentence(timeline.sides, result.outcome)}</p>
          {result.ratings.map((rating) => (
            <p key={rating.side}>
              {sideName(timeline.sides, rating.side)} rating: {rating.before} to{' '}
              {rating.after}
            </p>
          ))}
          <ol>
            {result.ballots.map((ballot, index) => (
              <li key={index}>
                <p>
                  Ballot {index + 1}:{' '}
                  {ballot.winner === null
                    ? 'No winner'
                    : sideName(timeline.sides, ballot.winner)}
                </p>
                <p>Scores: {scoresLine(timeline.sides, ballot)}</p>
                {ballot.reason ? <p>{ballot.reason}</p> : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {timeline.captions.length > 0 ? (
        <ol aria-label="Captions" className="flex flex-col gap-1 text-base">
          {timeline.captions.map((caption) => (
            <li key={caption.id}>
              {seatLabelIn(timeline, caption.seat)}: {caption.text}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
