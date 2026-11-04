import type { AudienceState } from '@daisy/protocol';

/** What a tab has read of a Round's published state, on its own clock. */
export type PublishedReads = {
  readonly state: AudienceState | null;
  readonly movedAtMs: number;
  readonly gone: boolean;
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
});

/**
 * A later object replaces an earlier one, never the reverse. A missing object says
 * nothing before a state has been seen: it may not be out yet. After one, its address
 * was withdrawn or its link replaced, so the page must ask the server again (ADR 0109).
 */
export const nextPublishedReads = (
  reads: PublishedReads,
  read: PublishedRead,
  nowMs: number,
): PublishedReads => {
  if (read.kind === 'missing')
    return reads.state === null ? reads : { ...reads, gone: true };
  if (
    read.kind === 'state' &&
    read.state.publishedAtMs > (reads.state?.publishedAtMs ?? -1)
  )
    return { state: read.state, movedAtMs: nowMs, gone: false };
  return reads;
};
