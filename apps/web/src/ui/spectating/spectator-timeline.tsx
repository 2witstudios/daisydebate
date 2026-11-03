import { speakerTotal, type SpectatorTimeline } from '@daisy/protocol';
import { formatCountdown } from '../../lib/clock-display';
import {
  resultSentence,
  sideLabel,
  stageSentence,
} from './spectator-timeline-copy';

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
          <li key={seat.side}>
            {sideLabel[seat.side]}: {seat.label ?? 'Unnamed debater'}
          </li>
        ))}
      </ul>
      <p aria-live="polite" className="text-base text-ink-muted">
        {stageSentence(timeline.stage)}
      </p>
      {timeline.stage.kind === 'floor' ? (
        <p role="timer" className="font-display text-xl font-bold tabular-nums">
          {`${formatCountdown(timeline.stage.remainingMs)} left`}
        </p>
      ) : null}
      {result ? (
        <div aria-live="polite">
          <p>{resultSentence(result.winner)}</p>
          {result.ratings.map((rating) => (
            <p key={rating.side}>
              {sideLabel[rating.side]} rating: {rating.before} to {rating.after}
            </p>
          ))}
          <ol>
            {result.ballots.map((ballot, index) => (
              <li key={index}>
                <p>
                  Ballot {index + 1}: {sideLabel[ballot.winner]}
                </p>
                <p>
                  Scores: Affirmative {speakerTotal(ballot.scores.affirmative)},
                  Negative {speakerTotal(ballot.scores.negative)}
                </p>
                <p>{ballot.reason}</p>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {timeline.captions.length > 0 ? (
        <ol aria-label="Captions" className="flex flex-col gap-1 text-base">
          {timeline.captions.map((caption) => (
            <li key={caption.id}>
              {sideLabel[caption.side]}: {caption.text}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
