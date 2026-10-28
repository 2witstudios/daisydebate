import { createTrackClocks } from '@daisy/media/observation';
import type { createAudioSubscription } from '@daisy/media/subscription';
import type { cutCaptureClips } from '@daisy/media/clips';
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
  readonly seat: string;
  readonly segmentId: string;
  readonly frame: Parameters<typeof cutCaptureClips>[0]['frames'][number];
};
/**
 * Private validation staging only. No WAV, coverage, text or future-grant
 * replay. Unvalidated PCM is bounded by this cap, never by wall-clock age: a
 * frame waits for the next batch however long that batch's history read
 * takes, since dropping it would leave a hole in coverage (ISSUE-577).
 */
const MAX_STAGED = 4096;
export function createCaptureStaging(input: {
  readonly current: () => Snapshot;
  readonly dropped: (count: number) => void;
  readonly retained: () => void;
}) {
  const clocks = createTrackClocks();
  // Frames refused for crossing a grant edge: the edge evidence observedWindow reads.
  const edges = new Map<string, FrameWindow[]>();
  const rememberEdge = (trackId: string, frame: FrameWindow) => {
    const kept = [...(edges.get(trackId) ?? []), frame];
    edges.set(trackId, kept.slice(-8));
  };
  let pending: StagedFrame[] = [];
  /** At most MAX_STAGED frames, however they arrived: the oldest are dropped. */
  const bound = () => {
    const excess = pending.length - MAX_STAGED;
    if (excess <= 0) return;
    pending = pending.slice(excess);
    input.dropped(excess);
  };
  const candidate = (raw: Raw): StagedFrame | null => {
    const current = input.current();
    const peer = current.state.participants.find(
      (p) => p.identity === raw.identity,
    );
    if (!peer || !current.state.segment) return null;
    const window = clocks.observe(raw, current.calibration);
    if (!window) return null;
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
  return {
    /** The frame it retained, or null when refused. */
    observe(raw: Raw): StagedFrame | null {
      const frame = candidate(raw);
      if (!frame) {
        input.dropped(1);
        return null;
      }
      pending.push(frame);
      bound();
      input.retained();
      return frame;
    },
    refresh(calibration: Snapshot['calibration']) {
      clocks.refresh(calibration);
    },
    closeTrack(trackId: string) {
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
      pending = [];
      clocks.clear();
      edges.clear();
    },
  };
}
