import { releasedThrough, segmentDue } from '@daisy/debate-engine';
import {
  coveredByHeartbeat,
  outsideControlLapses,
  parseHoldPlaylist,
  type BroadcastReleasePolicy,
  type ControlLapse,
  type HoldEntry,
} from '@daisy/protocol';
import {
  mediaPlaylist,
  RENDITIONS,
  type ReleasedSegment,
} from './hold-manifest';

const WINDOW = 6;

/** Egress finishes writing its last segments this long after a stop (measured: 2 s). */
const HOLD_SETTLE_MS = 10_000;

export type EncodedRendition = {
  readonly rendition: string;
  readonly file: string;
};

export type ReleasePorts = {
  readonly readHoldPlaylist: () => Promise<string>;
  readonly encode: (entry: HoldEntry) => Promise<readonly EncodedRendition[]>;
  readonly publishSegment: (
    seq: number,
    rendition: string,
    file: string,
  ) => Promise<void>;
  /** Written fresh, never cached: a stale manifest stops a live stream (BCAST-1). */
  readonly publishManifest: (key: string, text: string) => Promise<void>;
  /** False means the lease moved on, so this worker no longer owns the job. */
  readonly recordReleased: (
    seq: number,
    mediaEndMs: number,
  ) => Promise<boolean>;
  /** Every held segment is out, so the timeline reaches the end of the media. */
  readonly recordEnded: (mediaEndMs: number) => Promise<boolean>;
  /** This attempt's hold is empty and a later attempt exists: move to it. */
  readonly recordAdvanced: () => Promise<boolean>;
};

export type ReleaseInput = {
  readonly policy: BroadcastReleasePolicy;
  /** The public sequence, across attempts. */
  readonly nextSegment: number;
  /** The position in this attempt's hold. */
  readonly holdCursor: number;
  /** How many attempts came before the one being released. */
  readonly attemptIndex: number;
  /** When a later Egress attempt started; null when this is the latest. */
  readonly laterAttemptStartedMs: number | null;
  readonly streamEnded: boolean;
  readonly nowMs: number;
  readonly roundEndedAtMs: number | null;
  /** Known once the Egress stopped; a cursor past the hold then ends the stream. */
  readonly finalMediaEndMs: number | null;
  /** The last control-plane heartbeat: no media after it leaves (ADR 0099). */
  readonly heartbeatMs: number | null;
  /** Stretches with no control plane: media in them is never released. */
  readonly controlLapses: readonly ControlLapse[];
};

export type ReleaseResult =
  | { readonly kind: 'waiting' }
  /** Due, but captured past the last heartbeat. */
  | { readonly kind: 'lapsed' }
  | { readonly kind: 'fenced' }
  | { readonly kind: 'ended' }
  | { readonly kind: 'advanced' }
  | { readonly kind: 'released'; readonly released: ReleasedSegment };

/** The newest segments of this attempt's hold, up to `cursor`, under public sequences. */
const windowEndingAt = (
  held: readonly HoldEntry[],
  cursor: number,
  seq: number,
  lapses: readonly ControlLapse[],
): ReleasedWindow => {
  const start = Math.max(0, cursor - WINDOW + 1);
  const segments = held.slice(start, cursor + 1).map((e, i, all) => ({
    seq: seq - all.length + 1 + i,
    capturedAtMs: e.capturedAtMs,
    durationMs: e.durationMs,
  }));
  const lapseBefore = (index: number) =>
    index > 0 &&
    lapses.some(
      ({ fromMs, toMs }) =>
        fromMs < held[index]!.capturedAtMs &&
        toMs > held[index - 1]!.capturedAtMs,
    );
  // Grows only, across attempts too: an earlier stretch can only have scrolled out.
  const passedBy = held[Math.max(0, start - 1)]?.capturedAtMs ?? 0;
  return {
    segments,
    afterLapse: segments
      .filter((_, i) => lapseBefore(start + i))
      .map((segment) => segment.seq),
    lapsesPassed: lapses.filter(({ toMs }) => toMs <= passedBy).length,
  };
};

type ReleasedWindow = {
  readonly segments: readonly ReleasedSegment[];
  readonly afterLapse: readonly number[];
  readonly lapsesPassed: number;
};

const publishManifests = async (
  ports: Pick<ReleasePorts, 'publishManifest'>,
  window: ReleasedWindow,
  ended: boolean,
  attempt: { readonly index: number; readonly firstSeq: number },
) => {
  for (const { name } of RENDITIONS)
    await ports.publishManifest(
      `${name}/index.m3u8`,
      mediaPlaylist(window.segments, {
        ended,
        attempt,
        afterLapse: window.afterLapse,
        lapsesPassed: window.lapsesPassed,
      }),
    );
};

/**
 * Nothing is left to release, and no more media is coming: the manifests say so
 * and the timeline reaches the media's end, so the Broadcast can complete even
 * when the last segment ended seconds before the stop, or none was ever held.
 */
const endStream = async (
  input: ReleaseInput,
  finalMediaEndMs: number,
  held: readonly HoldEntry[],
  ports: ReleasePorts,
): Promise<ReleaseResult> => {
  if (held.length > 0)
    await publishManifests(
      ports,
      windowEndingAt(
        held,
        held.length - 1,
        input.nextSegment - 1,
        input.controlLapses,
      ),
      true,
      {
        index: input.attemptIndex,
        firstSeq: input.nextSegment - held.length,
      },
    );
  return (await ports.recordEnded(finalMediaEndMs))
    ? { kind: 'ended' }
    : { kind: 'fenced' };
};

/**
 * One segment, at the cursor only. The order is the guarantee: media reaches
 * object storage, then the manifests name it, and only then does the watermark
 * move, so no fact can overtake the media. A crash repeats the same segment.
 */
export const releaseStep = async (
  input: ReleaseInput,
  ports: ReleasePorts,
): Promise<ReleaseResult> => {
  // Removed before anything counts, so a lapse is never released, even once the
  // heartbeat has moved past it, and leaves no hole in the public sequence.
  const held = outsideControlLapses(
    parseHoldPlaylist(await ports.readHoldPlaylist()),
    input.controlLapses,
  );
  const entry = held[input.holdCursor];
  if (!entry) {
    if (input.laterAttemptStartedMs !== null)
      return input.nowMs >= input.laterAttemptStartedMs + HOLD_SETTLE_MS
        ? (await ports.recordAdvanced())
          ? { kind: 'advanced' }
          : { kind: 'fenced' }
        : { kind: 'waiting' };
    const end = input.finalMediaEndMs;
    return end !== null &&
      !input.streamEnded &&
      input.nowMs >= end + HOLD_SETTLE_MS
      ? endStream(input, end, held, ports)
      : { kind: 'waiting' };
  }
  if (
    !segmentDue(input.policy, entry, {
      nowMs: input.nowMs,
      roundEndedAtMs: input.roundEndedAtMs,
    })
  )
    return { kind: 'waiting' };
  if (!coveredByHeartbeat(entry, input.heartbeatMs)) return { kind: 'lapsed' };
  const seq = input.nextSegment;
  for (const { rendition, file } of await ports.encode(entry))
    await ports.publishSegment(seq, rendition, file);
  const window = windowEndingAt(
    held,
    input.holdCursor,
    seq,
    input.controlLapses,
  );
  await publishManifests(ports, window, false, {
    index: input.attemptIndex,
    firstSeq: seq - input.holdCursor,
  });
  const recorded = await ports.recordReleased(
    seq,
    releasedThrough(null, entry),
  );
  return recorded
    ? { kind: 'released', released: window.segments.at(-1)! }
    : { kind: 'fenced' };
};
