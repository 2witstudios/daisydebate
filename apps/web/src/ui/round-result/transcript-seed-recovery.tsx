'use client';
import { useEffect, useState } from 'react';
import { readTranscript } from '../../features/round-runtime/read-transcript';
import {
  askForTranscriptSeed,
  type TranscriptSeed,
} from '../../features/round-runtime/transcript-seed';
import { reconnectDelaySeconds } from '../debate-room/reconnect-delay';
import { LiveTranscript, type TranscriptPlacement } from './live-transcript';

/** The failed-read pace a transcript with a seed already keeps. */
const LONGEST_WAIT_MS = 30_000;

const nextAskMs = (asked: number) => {
  const [entropy] = crypto.getRandomValues(new Uint8Array(1));
  return Math.min(
    reconnectDelaySeconds(entropy!) * 1000 * 2 ** asked,
    LONGEST_WAIT_MS,
  );
};

/** A room whose transcript seed was refused, asking again without reloading it. */
export function TranscriptSeedRecovery({
  roundId,
  socketUrl,
  placement,
}: {
  readonly roundId: string;
  readonly socketUrl: string | null;
  readonly placement: TranscriptPlacement;
}) {
  const [state, setState] = useState<TranscriptSeed>({ kind: 'asking' });
  useEffect(
    () =>
      askForTranscriptSeed({
        read: () => readTranscript(window.fetch.bind(window), roundId),
        schedule: (attempt, asked) => {
          const timer = window.setTimeout(attempt, nextAskMs(asked));
          return () => window.clearTimeout(timer);
        },
        settled: setState,
      }),
    [roundId],
  );
  return (
    <TranscriptSeedAnswer
      state={state}
      socketUrl={socketUrl}
      placement={placement}
    />
  );
}

/** One refusal, one wording: a sidebar panel is never left blank. */
export function TranscriptSeedAnswer({
  state,
  socketUrl,
  placement,
}: {
  readonly state: TranscriptSeed;
  readonly socketUrl: string | null;
  readonly placement: TranscriptPlacement;
}) {
  if (state.kind === 'found')
    return (
      <LiveTranscript
        seed={state.seed}
        socketUrl={socketUrl}
        placement={placement}
      />
    );
  if (state.kind === 'denied')
    return placement === 'sidebar' ? (
      <p role="status" className="p-4 text-sm text-ink-muted">
        Transcript unavailable.
      </p>
    ) : null;
  return (
    <p role="status" className="p-4 text-sm">
      Transcript unavailable.
      {state.kind === 'outdated' ? (
        <>
          {' '}
          <button
            type="button"
            className="cursor-pointer font-strong underline"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </>
      ) : (
        <noscript> Reload to try again.</noscript>
      )}
    </p>
  );
}
