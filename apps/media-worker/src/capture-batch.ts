import {
  CLIP_PAUSE_MS,
  cutCaptureClips,
  type ClipCarry,
} from '@daisy/media/clips';
import {
  readCaptureHistory,
  straddlesGrantEdge,
  type CaptureClient,
} from './capture-history';
import type { StagedFrame } from './capture-staging';
/** How often the session loop validates its staged frames into clips. */
export const CAPTURE_BATCH_INTERVAL_MS = 250;
const streamKey = (segmentId: string, seat: string) =>
  JSON.stringify([segmentId, seat]);
/**
 * Each segment/seat stream's admitted frames not yet cut, kept between batches
 * so a clip ends at a pause or the sixty-second bound, not every 250 ms batch
 * (VIDEO-4.1-r7).
 */
export type ClipCarries = Map<string, ClipCarry>;
/** The stream ends or seals: its carried frames become its last clip. */
export function flushClipCarry(
  carries: ClipCarries,
  roundId: string,
  stream: { readonly segmentId: string; readonly roundParticipantId: string },
) {
  const key = streamKey(stream.segmentId, stream.roundParticipantId);
  const carry = carries.get(key);
  carries.delete(key);
  if (!carry?.frames.length) return [];
  return cutCaptureClips({
    roundId,
    roundParticipantId: stream.roundParticipantId,
    serverNowMs: carry.frames.at(-1)!.frame.afterMs,
    segments: [],
    intervals: [],
    frames: [],
    carry,
    final: true,
  }).clips;
}
/**
 * Ends every carry whose frames stopped a pause ago, by server time: a bot's
 * track goes quiet when its speech ends, and its transcript must not wait for
 * the segment's end (VIDEO-4.1-r7).
 */
export function flushQuietCarries(
  carries: ClipCarries,
  roundId: string,
  serverNowMs: number,
) {
  return [...carries].flatMap(([key, carry]) => {
    const last = carry.frames.at(-1);
    if (last && serverNowMs - last.frame.afterMs < CLIP_PAUSE_MS) return [];
    const [segmentId, roundParticipantId] = JSON.parse(key) as [string, string];
    return flushClipCarry(carries, roundId, { segmentId, roundParticipantId });
  });
}
/** Staged frames grouped per segment and seat, in arrival order. */
function bySegmentSeat(frames: readonly StagedFrame[]) {
  const groups = new Map<string, StagedFrame[]>();
  for (const frame of frames) {
    const key = streamKey(frame.segmentId, frame.seat);
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
  readonly carries: ClipCarries;
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
    // The history authorizes frames up to its read time only (cutCaptureClips).
    const readMs = Date.parse(history.state.serverNow);
    const valid = frames.filter((f) => f.frame.afterMs <= readMs);
    input.held(frames.filter((f) => f.frame.afterMs > readMs));
    for (const { frame } of valid)
      if (straddlesGrantEdge(history.state, first.seat, frame))
        input.straddled(frame);
    const cut = cutStream(input, history.state, first.seat, valid);
    input.dropped(cut.droppedFrames);
    for (const clip of cut.clips) input.clip(clip);
  }
}
/** One stream's validated frames cut onto its carry; the uncut rest is carried again. */
function cutStream(
  input: Pick<
    Parameters<typeof validateCaptureBatch>[0],
    'roundId' | 'carries'
  >,
  state: Awaited<ReturnType<CaptureClient['read']>>['state'],
  seat: string,
  frames: readonly StagedFrame[],
) {
  const segment = state.segment!;
  const key = streamKey(segment.id, seat);
  const cut = cutCaptureClips({
    roundId: input.roundId,
    roundParticipantId: seat,
    serverNowMs: Date.parse(state.serverNow),
    segments: [
      {
        id: segment.id,
        startedAtMs: Date.parse(segment.startedAt),
        endedAtMs:
          segment.endedAt === null ? null : Date.parse(segment.endedAt),
        durationMs: segment.durationMs,
      },
    ],
    intervals: state.intervals.map((i) => ({
      segmentId: segment.id,
      roundParticipantId: i.roundParticipantId,
      startedAtMs: Date.parse(i.startedAt),
      endedAtMs: i.endedAt === null ? null : Date.parse(i.endedAt),
    })),
    frames: frames.map((f) => f.frame),
    carry: input.carries.get(key) ?? null,
    final: false,
  });
  if (cut.carry) input.carries.set(key, cut.carry);
  return cut;
}
