import { releasedThrough, segmentDue } from '@daisy/debate-engine';
import type { BroadcastReleasePolicy } from '@daisy/protocol';
import {
  mediaPlaylist,
  parseHoldPlaylist,
  RENDITIONS,
  type ReleasedSegment,
} from './hold-manifest';

const WINDOW = 6;

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
};

export type ReleaseInput = {
  readonly policy: BroadcastReleasePolicy;
  readonly nextSegment: number;
  readonly nowMs: number;
  readonly roundEndedAtMs: number | null;
  /** Known once the Egress stopped; the last held segment then ends the stream. */
  readonly finalMediaEnded: boolean;
};

export type ReleaseResult =
  | { readonly kind: 'waiting' }
  | { readonly kind: 'fenced' }
  | { readonly kind: 'released'; readonly released: ReleasedSegment };

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
  if (
    !entry ||
    !segmentDue(input.policy, entry, {
      nowMs: input.nowMs,
      roundEndedAtMs: input.roundEndedAtMs,
    })
  )
    return { kind: 'waiting' };
  const seq = input.nextSegment;
  for (const { rendition, file } of await ports.encode(entry.name))
    await ports.publishSegment(seq, rendition, file);
  const window = held
    .slice(Math.max(0, seq - WINDOW + 1), seq + 1)
    .map((e, i, all) => ({
      seq: seq - all.length + 1 + i,
      capturedAtMs: e.capturedAtMs,
      durationMs: e.durationMs,
    }));
  for (const { name } of RENDITIONS)
    await ports.publishManifest(
      `${name}/index.m3u8`,
      mediaPlaylist(window, {
        ended: input.finalMediaEnded && seq === held.length - 1,
      }),
    );
  const recorded = await ports.recordReleased(
    seq,
    releasedThrough(null, entry),
  );
  return recorded
    ? { kind: 'released', released: window.at(-1)! }
    : { kind: 'fenced' };
};
