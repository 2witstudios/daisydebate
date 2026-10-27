import type { CaptureState } from './capture-history';

type HeardTrack = {
  readonly epoch: number;
  readonly segmentId: string;
  readonly roundParticipantId: string;
  readonly trackId: string;
};
const MAX_TRACKS = 64;
/**
 * Reports each bot track capture has subscribed to and reads, once, so the
 * bot credits speech only after capture can hear it (ISSUE-514-r2). A lost
 * report is sent again on its independent loop; a human track needs none.
 */
export function createHeardReporter(input: {
  readonly heard: (track: HeardTrack, signal: AbortSignal) => Promise<void>;
}) {
  const pending = new Map<string, string>();
  return {
    started({ identity, trackId }: { identity: string; trackId: string }) {
      if (pending.size < MAX_TRACKS) pending.set(trackId, identity);
    },
    closed: (trackId: string) => pending.delete(trackId),
    async report(state: CaptureState, epoch: number, signal: AbortSignal) {
      const segment = state.segment;
      if (!segment || segment.endedAt !== null) return;
      await Promise.allSettled(
        [...pending].map(async ([trackId, identity]) => {
          const seat = state.participants.find((p) => p.identity === identity);
          if (seat?.kind !== 'bot') {
            pending.delete(trackId);
            return;
          }
          await input.heard(
            {
              epoch,
              segmentId: segment.id,
              roundParticipantId: seat.roundParticipantId,
              trackId,
            },
            signal,
          );
          pending.delete(trackId);
        }),
      );
    },
  };
}

/** Single-flight I/O on its own cadence; the capture batch never waits for it. */
export async function reportHeardTracks(input: {
  readonly reporter: ReturnType<typeof createHeardReporter>;
  readonly state: () => CaptureState;
  readonly epoch: number;
  readonly signal: AbortSignal;
  readonly nowMs: () => number;
  readonly waitUntilMs: (due: number, signal: AbortSignal) => Promise<void>;
}) {
  while (!input.signal.aborted) {
    const due = input.nowMs() + 250;
    await input.reporter.report(input.state(), input.epoch, input.signal);
    await input.waitUntilMs(due, input.signal).catch(() => undefined);
  }
}
