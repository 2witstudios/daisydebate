import { releasedThrough, segmentDue } from '@daisy/debate-engine';
import {
  parseHoldPlaylist,
  publicClips,
  settledByHeartbeat,
  type BroadcastReleasePolicy,
  type HoldEntry,
  type PublicClip,
  type StageInterval,
} from '@daisy/protocol';
import {
  mediaPlaylist,
  RENDITIONS,
  type ReleasedSegment,
} from './hold-manifest';

const WINDOW = 6;
/** Media just captured may not be in the playlist yet: wake this much before its due time. */
const NOT_LISTED_YET_MS = 10_000;

/** Egress finishes writing its last segments this long after a stop (measured: 2 s). */
const HOLD_SETTLE_MS = 10_000;

export type EncodedRendition = {
  readonly rendition: string;
  readonly file: string;
};

export type Clip = PublicClip<HoldEntry, StageInterval>;

export type ReleasePorts = {
  readonly readHoldPlaylist: () => Promise<string>;
  readonly encode: (clip: Clip) => Promise<readonly EncodedRendition[]>;
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
  /** Settled time with nothing public in it has come due: no media, only the timeline. */
  readonly recordPassed: (throughMs: number) => Promise<boolean>;
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
  /** Known once the Egress stopped; a cursor past the hold then ends the stream. */
  readonly finalMediaEndMs: number | null;
  /** The last heartbeat: past it, what history says is not yet settled (ADR 0099). */
  readonly heartbeatMs: number | null;
  /** What committed history knows, by kind: nothing outside this is ever released. */
  readonly stage: readonly StageInterval[];
  /** Clips given up on, by capture time: stated gaps, never published. */
  readonly skippedClips: readonly number[];
  /** The durable watermark as last read, so a pass with nothing new writes nothing. */
  readonly releasedThroughMs: number | null;
};

export type ReleaseResult =
  /** `nextDueMs`: nothing can be due before then, as far as this pass knows. */
  | { readonly kind: 'waiting'; readonly nextDueMs?: number }
  /** Due, but no committed history reaches it yet. */
  | { readonly kind: 'lapsed' }
  | { readonly kind: 'fenced' }
  | { readonly kind: 'ended' }
  | { readonly kind: 'advanced' }
  | { readonly kind: 'released'; readonly released: ReleasedSegment };

/** Clips further apart than this have something missing between them. */
const JOINED_WITHIN_MS = 250;

type Clips = readonly Clip[];

/** The newest clips of this attempt's hold, up to `cursor`, under public sequences. */
const windowEndingAt = (
  clips: Clips,
  cursor: number,
  seq: number,
  intervals: readonly StageInterval[],
): ReleasedWindow => {
  const start = Math.max(0, cursor - WINDOW + 1);
  const segments = clips.slice(start, cursor + 1).map((clip, i, all) => ({
    seq: seq - all.length + 1 + i,
    capturedAtMs: clip.capturedAtMs,
    durationMs: clip.durationMs,
  }));
  const gapBefore = (index: number) => {
    const previous = clips[index - 1];
    return (
      previous !== undefined &&
      (previous.interval.kind !== clips[index]!.interval.kind ||
        clips[index]!.capturedAtMs -
          (previous.capturedAtMs + previous.durationMs) >
          JOINED_WITHIN_MS)
    );
  };
  // Grows only, across attempts too: an earlier gap can only have scrolled out.
  const passedBy = clips[Math.max(0, start - 1)]?.capturedAtMs ?? 0;
  return {
    segments,
    afterGap: segments
      .filter((_, i) => gapBefore(start + i))
      .map((segment) => segment.seq),
    gapsPassed: intervals.filter(({ toMs }) => toMs <= passedBy).length,
  };
};

type ReleasedWindow = {
  readonly segments: readonly ReleasedSegment[];
  readonly afterGap: readonly number[];
  readonly gapsPassed: number;
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
        afterGap: window.afterGap,
        gapsPassed: window.gapsPassed,
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
  held: Clips,
  ports: ReleasePorts,
): Promise<ReleaseResult> => {
  if (held.length > 0)
    await publishManifests(
      ports,
      windowEndingAt(held, held.length - 1, input.nextSegment - 1, input.stage),
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
  // Only what is settled counts, and only its public clips: nothing else is ever
  // released, positions never shift, and what is left out leaves no hole in the
  // public sequence.
  const entries = parseHoldPlaylist(
    await ports.readHoldPlaylist(),
    input.nowMs,
  );
  const settled = entries.filter((one) =>
    settledByHeartbeat(one, input.heartbeatMs),
  );
  const held = publicClips(settled, input.stage).filter(
    (clip) => !input.skippedClips.includes(clip.capturedAtMs),
  );
  const entry = held[input.holdCursor];
  const unsettled = entries[settled.length];
  // Due settled time before the next clip holds nothing to release, or the watermark
  // would sit still through a long prep and read as a stalled Broadcast.
  const due = (one: { capturedAtMs: number; durationMs: number }) =>
    segmentDue(input.policy, one, input.nowMs);
  const lastDue = settled.filter(due).at(-1);
  if (lastDue && !(entry && due({ ...entry.source, ...entry }))) {
    const through = Math.min(
      lastDue.capturedAtMs + lastDue.durationMs,
      entry?.capturedAtMs ?? Number.POSITIVE_INFINITY,
    );
    if (
      through > (input.releasedThroughMs ?? 0) &&
      !(await ports.recordPassed(through))
    )
      return { kind: 'fenced' };
  }
  const dueAtMs = (one: { capturedAtMs: number; durationMs: number }) =>
    one.capturedAtMs + one.durationMs + input.policy.seconds * 1000;
  if (!entry && unsettled)
    return due(unsettled)
      ? { kind: 'lapsed' }
      : { kind: 'waiting', nextDueMs: dueAtMs(unsettled) };
  if (!entry) {
    if (input.laterAttemptStartedMs !== null)
      return input.nowMs >= input.laterAttemptStartedMs + HOLD_SETTLE_MS
        ? (await ports.recordAdvanced())
          ? { kind: 'advanced' }
          : { kind: 'fenced' }
        : { kind: 'waiting' };
    const end = input.finalMediaEndMs;
    // The delay is a floor here too: this moves the watermark, and facts follow it.
    return end !== null &&
      !input.streamEnded &&
      input.nowMs >= end + HOLD_SETTLE_MS &&
      due({ capturedAtMs: end, durationMs: 0 })
      ? endStream(input, end, held, ports)
      : {
          kind: 'waiting',
          ...(input.streamEnded
            ? {}
            : {
                nextDueMs:
                  end === null
                    ? input.nowMs +
                      input.policy.seconds * 1000 -
                      NOT_LISTED_YET_MS
                    : Math.max(
                        end + HOLD_SETTLE_MS,
                        dueAtMs({ capturedAtMs: end, durationMs: 0 }),
                      ),
              }),
        };
  }
  if (!due(entry)) return { kind: 'waiting', nextDueMs: dueAtMs(entry) };
  const seq = input.nextSegment;
  for (const { rendition, file } of await ports.encode(entry))
    await ports.publishSegment(seq, rendition, file);
  const window = windowEndingAt(held, input.holdCursor, seq, input.stage);
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
