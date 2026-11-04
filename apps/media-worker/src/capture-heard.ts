import type { CaptureState } from './capture-history';

type HeardTrack = {
  readonly epoch: number;
  readonly segmentId: string | null;
  readonly roundParticipantId: string;
  readonly trackId: string;
};
const MAX_TRACKS = 64;
/** Well inside the report's 30 s life, so a long-open microphone stays reported. */
const REPORT_AGAIN_MS = 10_000;
/**
 * Reports each seat's track capture has subscribed to and reads, and again while it is
 * read, so a bot credits speech only after capture can hear it (ISSUE-514-r2), a held Round
 * resumes only then, and a speech can start knowing capture has its speaker. It confirms the
 * subscription, not a frame: a silent microphone may send none. A lost report is sent again
 * on its independent loop.
 */
export function createHeardReporter(input: {
  readonly heard: (track: HeardTrack, signal: AbortSignal) => Promise<void>;
  readonly nowMs: () => number;
}) {
  const tracks = new Map<
    string,
    { readonly identity: string; reportedAtMs: number | null }
  >();
  return {
    started({ identity, trackId }: { identity: string; trackId: string }) {
      if (tracks.size < MAX_TRACKS)
        tracks.set(trackId, { identity, reportedAtMs: null });
    },
    closed: (trackId: string) => tracks.delete(trackId),
    async report(state: CaptureState, epoch: number, signal: AbortSignal) {
      const open = state.segment?.endedAt === null ? state.segment.id : null;
      const nowMs = input.nowMs();
      await Promise.allSettled(
        [...tracks]
          .filter(
            ([, track]) =>
              track.reportedAtMs === null ||
              nowMs - track.reportedAtMs >= REPORT_AGAIN_MS,
          )
          .map(async ([trackId, track]) => {
            const seat = state.participants.find(
              (p) => p.identity === track.identity,
            );
            if (!seat) {
              tracks.delete(trackId);
              return;
            }
            await input.heard(
              {
                epoch,
                segmentId: open,
                roundParticipantId: seat.roundParticipantId,
                trackId,
              },
              signal,
            );
            track.reportedAtMs = nowMs;
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
