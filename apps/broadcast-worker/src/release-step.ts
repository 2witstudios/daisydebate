import { releasedThrough, segmentDue } from '@daisy/debate-engine';
import type { BroadcastReleasePolicy } from '@daisy/protocol';
import {
  mediaPlaylist,
  parseHoldPlaylist,
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
  readonly encode: (holdName: string) => Promise<readonly EncodedRendition[]>;
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
};

export type ReleaseInput = {
  readonly policy: BroadcastReleasePolicy;
  readonly nextSegment: number;
  readonly nowMs: number;
  readonly roundEndedAtMs: number | null;
  /** Known once the Egress stopped; a cursor past the hold then ends the stream. */
  readonly finalMediaEndMs: number | null;
  readonly releasedThroughMs: number | null;
};

export type ReleaseResult =
  | { readonly kind: 'waiting' }
  | { readonly kind: 'fenced' }
  | { readonly kind: 'ended' }
  | { readonly kind: 'released'; readonly released: ReleasedSegment };

const windowEndingAt = (
  held: ReturnType<typeof parseHoldPlaylist>,
  seq: number,
): readonly ReleasedSegment[] =>
  held.slice(Math.max(0, seq - WINDOW + 1), seq + 1).map((e, i, all) => ({
    seq: seq - all.length + 1 + i,
    capturedAtMs: e.capturedAtMs,
    durationMs: e.durationMs,
  }));

const publishManifests = async (
  ports: Pick<ReleasePorts, 'publishManifest'>,
  segments: readonly ReleasedSegment[],
  ended: boolean,
) => {
  for (const { name } of RENDITIONS)
    await ports.publishManifest(
      `${name}/index.m3u8`,
      mediaPlaylist(segments, { ended }),
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
  held: ReturnType<typeof parseHoldPlaylist>,
  ports: ReleasePorts,
): Promise<ReleaseResult> => {
  if (held.length > 0)
    await publishManifests(ports, windowEndingAt(held, held.length - 1), true);
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
  const held = parseHoldPlaylist(await ports.readHoldPlaylist());
  const entry = held[input.nextSegment];
  if (!entry) {
    const end = input.finalMediaEndMs;
    return end !== null &&
      input.nowMs >= end + HOLD_SETTLE_MS &&
      (input.releasedThroughMs ?? Number.NEGATIVE_INFINITY) < end
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
  const seq = input.nextSegment;
  for (const { rendition, file } of await ports.encode(entry.name))
    await ports.publishSegment(seq, rendition, file);
  const window = windowEndingAt(held, seq);
  await publishManifests(ports, window, false);
  const recorded = await ports.recordReleased(
    seq,
    releasedThrough(null, entry),
  );
  return recorded
    ? { kind: 'released', released: window.at(-1)! }
    : { kind: 'fenced' };
};
