import { cutCaptureClips } from '@daisy/media/clips';
import { readCaptureHistory, type CaptureClient } from './capture-history';
import type { StagedFrame } from './capture-staging';
export async function validateCaptureBatch(input: {
  readonly frames: readonly StagedFrame[];
  readonly current: Awaited<ReturnType<CaptureClient['read']>>;
  readonly client: CaptureClient;
  readonly roundId: string;
  readonly epoch: number;
  readonly signal: AbortSignal;
  readonly nowMs: () => number;
  readonly dropped: (n: number) => void;
  readonly clip: (
    clip: ReturnType<typeof cutCaptureClips>['clips'][number],
  ) => void;
}) {
  const groups = new Map<string, StagedFrame[]>();
  for (const frame of input.frames) {
    const key = JSON.stringify([frame.segmentId, frame.seat]);
    const group = groups.get(key) ?? [];
    group.push(frame);
    groups.set(key, group);
  }
  for (const frames of groups.values()) {
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
    const valid = frames.filter((f) => input.nowMs() - f.observedAtMs <= 500);
    input.dropped(frames.length - valid.length);
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
