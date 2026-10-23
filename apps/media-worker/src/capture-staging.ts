import { createCaptureClock } from '@daisy/media/observation';
import type { createCaptureSubscription } from '@daisy/media/capture';
import type { cutCaptureClips } from '@daisy/media/clips';
import {
  contained,
  straddlesGrantEdge,
  type CaptureClient,
  type FrameWindow,
} from './capture-history';
type Snapshot = Awaited<ReturnType<CaptureClient['read']>>;
type Raw = Parameters<
  Parameters<typeof createCaptureSubscription>[0]['onFrame']
>[0];
export type StagedFrame = {
  readonly seat: string;
  readonly segmentId: string;
  readonly frame: Parameters<typeof cutCaptureClips>[0]['frames'][number];
  /** Native callback sequence and brackets, kept for the activity relay. */
  readonly original: {
    readonly sequence: number;
    readonly beforeMs: number;
    readonly afterMs: number;
  };
  readonly observedAtMs: number;
};
/** Private validation staging only. No WAV, coverage, text or future-grant replay. */
export function createCaptureStaging(input: {
  readonly current: () => Snapshot;
  readonly nowMs: () => number;
  readonly dropped: (count: number) => void;
  readonly retained: () => void;
}) {
  const clocks = new Map<string, ReturnType<typeof createCaptureClock>>();
  // Frames refused for crossing a grant edge: the edge evidence observedWindow reads.
  const edges = new Map<string, FrameWindow[]>();
  const rememberEdge = (trackId: string, frame: FrameWindow) => {
    const kept = [...(edges.get(trackId) ?? []), frame];
    edges.set(trackId, kept.slice(-8));
  };
  let pending: StagedFrame[] = [];
  const candidate = (raw: Raw): StagedFrame | null => {
    const current = input.current();
    const peer = current.state.participants.find(
      (p) => p.identity === raw.identity,
    );
    if (!peer || !current.state.segment) return null;
    let clock = clocks.get(raw.trackId);
    if (!clock) {
      clock = createCaptureClock(current.calibration);
      clocks.set(raw.trackId, clock);
    }
    const window = clock.observe(raw);
    if (!window) return null;
    const beforeMs = Math.floor(window.beforeMs),
      afterMs = Math.ceil(window.afterMs),
      nominalStartMs = window.nominalStartMs;
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
      observedAtMs: raw.afterMs,
      original: {
        sequence: raw.sequence,
        beforeMs: raw.beforeMs,
        afterMs: raw.afterMs,
      },
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
      if (pending.length === 4096) {
        pending.shift();
        input.dropped(1);
      }
      pending.push(frame);
      input.retained();
      return frame;
    },
    refresh(calibration: Snapshot['calibration']) {
      for (const clock of clocks.values()) clock.refresh(calibration);
    },
    closeTrack(trackId: string) {
      clocks.delete(trackId);
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
    },
    take() {
      const frames = pending;
      pending = [];
      const valid = frames.filter((f) => input.nowMs() - f.observedAtMs <= 500);
      input.dropped(frames.length - valid.length);
      return valid;
    },
    clear() {
      input.dropped(pending.length);
      pending = [];
      clocks.clear();
      edges.clear();
    },
  };
}
