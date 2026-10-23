import { cutCaptureClips } from '@daisy/media/clips';
import {
  readCaptureHistory,
  straddlesGrantEdge,
  type CaptureClient,
} from './capture-history';
import type { StagedFrame } from './capture-staging';
/** A staged frame older than this is dropped rather than cut into a clip. */
export const STAGED_FRAME_MAX_AGE_MS = 500;
/** How often the session loop validates its staged frames into clips. */
export const CAPTURE_BATCH_INTERVAL_MS = 250;
/** Staged frames grouped per segment and seat, in arrival order. */
function bySegmentSeat(frames: readonly StagedFrame[]) {
  const groups = new Map<string, StagedFrame[]>();
  for (const frame of frames) {
    const key = JSON.stringify([frame.segmentId, frame.seat]);
    const group = groups.get(key) ?? [];
    group.push(frame);
    groups.set(key, group);
  }
  return groups.values();
}
export async function validateCaptureBatch(input: {
  readonly frames: readonly StagedFrame[];
  readonly current: Awaited<ReturnType<CaptureClient['read']>>;
  readonly client: CaptureClient;
  readonly roundId: string;
  readonly epoch: number;
  readonly signal: AbortSignal;
  readonly nowMs: () => number;
  readonly dropped: (n: number) => void;
  /** A staged frame that crosses a grant edge in the fresher history. */
  readonly straddled: (frame: StagedFrame['frame']) => void;
  readonly clip: (
    clip: ReturnType<typeof cutCaptureClips>['clips'][number],
  ) => void;
  /**
   * Frames observed after their history read: not yet authorized, so they go
   * back to staging for the next batch instead of being cut or dropped.
   */
  readonly held: (frames: readonly StagedFrame[]) => void;
}) {
  for (const frames of bySegmentSeat(input.frames)) {
    const first = frames[0]!;
    const history =
      first.segmentId === input.current.state.segment?.id
        ? input.current
        : await readCaptureHistory(
            input.client,
            input.epoch,
            input.signal,
            first.segmentId,
          );
    const segment = history.state.segment;
    if (!segment) {
      input.dropped(frames.length);
      continue;
    }
    const fresh = frames.filter(
      (f) => input.nowMs() - f.observedAtMs <= STAGED_FRAME_MAX_AGE_MS,
    );
    input.dropped(frames.length - fresh.length);
    // The history authorizes frames up to its read time only (cutCaptureClips).
    const readMs = Date.parse(history.state.serverNow);
    const valid = fresh.filter((f) => f.frame.afterMs <= readMs);
    input.held(fresh.filter((f) => f.frame.afterMs > readMs));
    for (const { frame } of valid)
      if (straddlesGrantEdge(history.state, first.seat, frame))
        input.straddled(frame);
    const cut = cutCaptureClips({
      roundId: input.roundId,
      roundParticipantId: first.seat,
      serverNowMs: Date.parse(history.state.serverNow),
      segments: [
        {
          id: segment.id,
          startedAtMs: Date.parse(segment.startedAt),
          endedAtMs:
            segment.endedAt === null ? null : Date.parse(segment.endedAt),
          durationMs: segment.durationMs,
        },
      ],
      intervals: history.state.intervals.map((i) => ({
        segmentId: segment.id,
        roundParticipantId: i.roundParticipantId,
        startedAtMs: Date.parse(i.startedAt),
        endedAtMs: i.endedAt === null ? null : Date.parse(i.endedAt),
      })),
      frames: valid.map((f) => f.frame),
    });
    input.dropped(cut.droppedFrames);
    for (const clip of cut.clips) input.clip(clip);
  }
}
