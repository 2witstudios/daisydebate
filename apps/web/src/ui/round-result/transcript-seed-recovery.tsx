'use client';
import { browserTransport } from '../edge/browser-request';
import { browserScheduler } from '../edge/browser-time';
import { useResource } from '../edge/use-driver';
import { Announcement } from '../components/announcement/announcement';
import { Button } from '../components/button/button';
import { useState } from 'react';
import {
  readTranscript,
  TRANSCRIPT_READ_DEADLINE_MS,
} from '../../features/round-runtime/read-transcript';
import {
  askForTranscriptSeed,
  type TranscriptSeed,
} from '../../features/round-runtime/transcript-seed';
import { drawReconnectDelaySeconds } from '../debate-room/reconnect-delay';
import { LiveTranscript, type TranscriptPlacement } from './live-transcript';

/** The failed-read pace a transcript with a seed already keeps. */
const LONGEST_WAIT_MS = 30_000;

const nextAskMs = (asked: number) =>
  Math.min(drawReconnectDelaySeconds() * 1000 * 2 ** asked, LONGEST_WAIT_MS);

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
  useResource(roundId, (round) => ({
    dispose: askForTranscriptSeed({
      read: () =>
        readTranscript(
          browserTransport,
          round,
          AbortSignal.timeout(TRANSCRIPT_READ_DEADLINE_MS),
        ),
      after: browserScheduler.after,
      waitMs: nextAskMs,
      settled: setState,
    }),
  }));
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
      <Announcement
        as="p"
        kind="progress"
        className="p-4 text-sm text-ink-muted"
      >
        Transcript unavailable.
      </Announcement>
    ) : null;
  return (
    <Announcement as="p" kind="progress" className="p-4 text-sm">
      Transcript unavailable.
      {state.kind === 'outdated' ? (
        <>
          {' '}
          <Button
            variant="text-link"
            type="button"

            onClick={() => window.location.reload()}
          >
            Reload
          </Button>
        </>
      ) : null}
    </Announcement>
  );
}
