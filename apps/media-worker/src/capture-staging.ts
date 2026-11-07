import {
  createTrackClocks,
  type FrameClockEvidence,
} from '@daisy/media/observation';
import type { createAudioSubscription } from '@daisy/media/subscription';
import type { cutCaptureClips } from './capture-clips';
import {
  contained,
  straddlesGrantEdge,
  type CaptureClient,
  type FrameWindow,
} from './capture-history';
type Snapshot = Awaited<ReturnType<CaptureClient['read']>>;
type Raw = Parameters<
  Parameters<typeof createAudioSubscription>[0]['onFrame']
>[0];
export type StagedFrame = {
  readonly clockEvidence: FrameClockEvidence;
  readonly seat: string;
  readonly segmentId: string;
  readonly frame: Parameters<typeof cutCaptureClips>[0]['frames'][number];
};
/** How long a frame waits for a history that admits it: a slow read, not a policy. */
const WAIT_MS = 1_000;
/** A second of audio for every seat a Round has at once, at 10 ms a frame. */
const MAX_WAITING_FRAMES = 400;
/**
 * Private validation staging only. No WAV, coverage or text. A frame that arrives before
 * this worker's history shows its speech open waits in memory for the next history, because
 * the clock started before this worker could know. What that history does not admit is
 * discarded and never stored. A wait is about a second while history reads run. If they
 * stop, it lasts until the next read or the track closes, with unvalidated PCM bounded only
 * by the frame cap. A frame already validated waits for its batch however long that batch's
 * history read takes, since dropping it would leave a hole in coverage (ISSUE-577).
 */
export function createCaptureStaging(input: {
  readonly current: () => Snapshot;
  readonly dropped: (count: number) => void;
  /** A held frame was dropped by the bound: its stream has a real gap. */
  readonly lost: (frame: StagedFrame) => void;
  readonly retained: () => void;
  readonly maxFrames: number;
}) {
  const clocks = createTrackClocks();
  // Frames refused for crossing a grant edge: the edge evidence observedWindow reads.
  const edges = new Map<string, FrameWindow[]>();
  const rememberEdge = (trackId: string, frame: FrameWindow) => {
    const kept = [...(edges.get(trackId) ?? []), frame];
    edges.set(trackId, kept.slice(-8));
  };
  let pending: StagedFrame[] = [];
  /** At most maxFrames frames, however they arrived: the oldest are dropped. */
  const bound = () => {
    const excess = pending.length - input.maxFrames;
    if (excess <= 0) return;
    pending.splice(0, excess).forEach(input.lost);
    input.dropped(excess);
  };
  type Window = NonNullable<ReturnType<typeof clocks.observe>>;
  type Waiting = {
    readonly raw: Raw;
    readonly window: Window;
    readonly clockEvidence: FrameClockEvidence;
  };
  let waiting: Waiting[] = [];
  const admit = ({
    raw,
    window,
    clockEvidence,
  }: Waiting): StagedFrame | null => {
    const current = input.current();
    const peer = current.state.participants.find(
      (p) => p.identity === raw.identity,
    );
    if (!peer || !current.state.segment) return null;
    const { beforeMs, afterMs, nominalStartMs } = window;
    if (
      !contained(current.state, peer.roundParticipantId, { beforeMs, afterMs })
    ) {
      if (
        straddlesGrantEdge(current.state, peer.roundParticipantId, {
          beforeMs,
          afterMs,
        })
      )
        rememberEdge(raw.trackId, { nominalStartMs, beforeMs, afterMs });
      return null;
    }
    return {
      clockEvidence,
      seat: peer.roundParticipantId,
      segmentId: current.state.segment.id,
      frame: {
        pcm: raw.pcm,
        trackId: raw.trackId,
        nominalStartMs,
        beforeMs,
        afterMs,
      },
    };
  };
  const retain = (frame: StagedFrame) => {
    pending.push(frame);
    bound();
    input.retained();
  };
  return {
    /** The frame it retained, or null when it waits or is refused. */
    observe(raw: Raw): StagedFrame | null {
      const window = clocks.observe(raw, input.current().calibration);
      if (!window) {
        input.dropped(1);
        return null;
      }
      const clockEvidence = clocks.evidence(raw.trackId);
      if (!clockEvidence) {
        input.dropped(1);
        return null;
      }
      const frame = admit({ raw, window, clockEvidence });
      if (!frame) {
        waiting.push({ raw, window, clockEvidence });
        const excess = waiting.length - MAX_WAITING_FRAMES;
        if (excess > 0) {
          waiting = waiting.slice(excess);
          input.dropped(excess);
        }
        return null;
      }
      retain(frame);
      return frame;
    },
    /** A fresher history: what waited for it is admitted, and the rest let go. */
    refresh(calibration: Snapshot['calibration']) {
      clocks.refresh(calibration);
      const serverNow = Date.parse(input.current().state.serverNow);
      const stillWaiting: Waiting[] = [];
      for (const frame of waiting) {
        const admitted = admit(frame);
        if (admitted) retain(admitted);
        else if (serverNow - frame.window.afterMs < WAIT_MS)
          stillWaiting.push(frame);
        else input.dropped(1);
      }
      waiting = stillWaiting;
    },
    closeTrack(trackId: string) {
      const kept = waiting.filter(({ raw }) => raw.trackId !== trackId);
      input.dropped(waiting.length - kept.length);
      waiting = kept;
      clocks.close(trackId);
      edges.delete(trackId);
    },
    /** Edge-straddling frames the batch saw against fresher history. */
    rememberEdge,
    /** The edge evidence for one track, newest last. */
    straddles: (trackId: string): readonly FrameWindow[] =>
      edges.get(trackId) ?? [],
    /** Frames a batch held back, ahead of those staged since, in order. */
    requeue(frames: readonly StagedFrame[]) {
      pending = [...frames, ...pending];
      bound();
    },
    /** Whether any staged frame belongs to the stream: it may not seal yet. */
    holds: (stream: {
      readonly segmentId: string;
      readonly roundParticipantId: string;
    }) =>
      pending.some(
        (f) =>
          f.segmentId === stream.segmentId &&
          f.seat === stream.roundParticipantId,
      ),
    take() {
      const frames = pending;
      pending = [];
      return frames;
    },
    clear() {
      input.dropped(pending.length);
      pending.forEach(input.lost);
      pending = [];
      input.dropped(waiting.length);
      waiting = [];
      clocks.clear();
      edges.clear();
    },
  };
}
