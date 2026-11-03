'use client';
import '../../lib/zod-jitless';
import {
  speakerTotal,
  spectatorTimelineSchema,
  type SpectatorTimeline,
} from '@daisy/protocol';
import { useEffect, useState } from 'react';
import {
  resultSentence,
  sideLabel,
  stageSentence,
} from './spectator-timeline-copy';

const POLL_MS = 2000;

/** The released facts as text: what the video shows, for anyone who cannot see it. */
export function SpectatorFacts({
  timeline,
}: {
  readonly timeline: SpectatorTimeline;
}) {
  const { result } = timeline;
  return (
    <section aria-label="Round facts" className="grid gap-4">
      {timeline.resolution ? <h1>{timeline.resolution}</h1> : null}
      <ul>
        {timeline.seats.map((seat) => (
          <li key={seat.side}>
            {sideLabel[seat.side]}: {seat.label ?? 'Unnamed debater'}
          </li>
        ))}
      </ul>
      <p aria-live="polite">{stageSentence(timeline.stage)}</p>
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
        <ol aria-label="Captions">
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

/**
 * The server-rendered snapshot, kept current by reading the same cacheable
 * answer every couple of seconds: no socket, and nothing beyond what any
 * visitor may read. A failed read keeps the last released facts on screen.
 */
export function SpectatorTimelineView({
  initial,
}: {
  readonly initial: SpectatorTimeline;
}) {
  const [timeline, setTimeline] = useState(initial);
  const ended = timeline.stage.kind === 'ended';
  useEffect(() => {
    if (ended) return;
    const poll = setInterval(() => {
      void fetch(`/api/rounds/${initial.roundId}/timeline`)
        .then((response) => (response.ok ? response.json() : null))
        .then((body) => {
          const parsed = spectatorTimelineSchema.safeParse(body);
          if (parsed.success) setTimeline(parsed.data);
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(poll);
  }, [ended, initial.roundId]);
  return <SpectatorFacts timeline={timeline} />;
}
