'use client';
import { useEffect, useState } from 'react';
import { readTranscript } from '../../features/round-runtime/read-transcript';
import {
  askForTranscriptSeed,
  type TranscriptSeed,
} from '../../features/round-runtime/transcript-seed';
import { reconnectDelaySeconds } from '../debate-room/reconnect-delay';
import { LiveTranscript, type TranscriptPlacement } from './live-transcript';

const nextAskMs = () => {
  const [entropy] = crypto.getRandomValues(new Uint8Array(1));
  return reconnectDelaySeconds(entropy!) * 1000;
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
        schedule: (attempt) => {
          const timer = window.setTimeout(attempt, nextAskMs());
          return () => window.clearTimeout(timer);
        },
        settled: setState,
      }),
    [roundId],
  );
  if (state.kind === 'found')
    return (
      <LiveTranscript
        seed={state.seed}
        socketUrl={socketUrl}
        placement={placement}
      />
    );
  if (state.kind === 'denied') return null;
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
