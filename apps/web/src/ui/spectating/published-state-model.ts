import type { AudienceState } from '@daisy/protocol';
import type { PollAnswer } from '../../features/spectating/poll-pace';

/** What a tab has read of a Round's published state, on its own clock. */
export type PublishedReads = {
  readonly state: AudienceState | null;
  readonly movedAtMs: number;
  readonly gone: boolean;
  /** Reads in a row that found the address gone; zero unless `gone`. */
  readonly missing: number;
};

/** One poll's answer: a state, nothing at that address, or no answer at all. */
export type PublishedRead =
  | { readonly kind: 'state'; readonly state: AudienceState }
  | { readonly kind: 'missing' }
  | { readonly kind: 'failed' };

export const firstPublishedReads = (nowMs: number): PublishedReads => ({
  state: null,
  movedAtMs: nowMs,
  gone: false,
  missing: 0,
});

/**
 * A later object replaces an earlier one, never the reverse. A missing object says
 * nothing before a state has been seen: it may not be out yet. After one, its address
 * was withdrawn or its link replaced, so the page must ask the server again (ADR 0109).
 * Any state read after that means the address is back.
 */
export const nextPublishedReads = (
  reads: PublishedReads,
  read: PublishedRead,
  nowMs: number,
): PublishedReads => {
  if (read.kind === 'missing')
    return reads.state === null
      ? reads
      : { ...reads, gone: true, missing: reads.missing + 1 };
  if (
    read.kind === 'state' &&
    read.state.publishedAtMs > (reads.state?.publishedAtMs ?? -1)
  )
    return { state: read.state, movedAtMs: nowMs, gone: false, missing: 0 };
  // The same object readable again: the address is back, though nothing moved.
  if (read.kind === 'state' && reads.gone)
    return { ...reads, gone: false, missing: 0 };
  return reads;
};

/**
 * What a read says about the next one. While the address is gone an answered
 * read counts as a miss, so a tab left on a withdrawn address slows to the
 * longest wait instead of asking every couple of seconds; the first state read
 * again restores the ordinary pace. A refusal keeps the wait the bucket asked for.
 */
export const paceOfPublishedRead = (
  reads: PublishedReads,
  answer: PollAnswer,
): PollAnswer =>
  reads.gone && answer.kind === 'answered' ? { kind: 'failed' } : answer;

/**
 * How many times the page should have asked the server while this address has
 * been gone: at the first missing read, then each time the run of them doubles.
 * The server may name the same address again, and replace the link only later,
 * so one ask is not enough; doubling keeps a crowd left on a withdrawn address
 * from reaching web more than a few times each (DEC-350). Zero unless gone.
 */
export const serverAsksOf = (reads: PublishedReads): number =>
  reads.gone ? Math.floor(Math.log2(reads.missing)) + 1 : 0;
