import { z } from 'zod';
import { idSchema } from './primitives';

/** One customer synchronization, shared by verified hints and missed-event repair. */
const billingSyncBounds = {
  leaseMs: 30_000,
  retryMs: 5_000,
  pollMs: 300_000,
} as const;
const instant = z.iso.datetime({ precision: 3 });
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const at = Date.parse;
export const billingSyncStateSchema = z.discriminatedUnion('kind', [
  z
    .strictObject({
      kind: z.literal('pending'),
      revision,
      requestedAt: instant,
      retryAt: instant,
    })
    .refine((s) => at(s.requestedAt) <= at(s.retryAt)),
  z
    .strictObject({
      kind: z.literal('claimed'),
      revision,
      requestedAt: instant,
      claim: z.strictObject({
        id: idSchema,
        claimedAt: instant,
        expiresAt: instant,
      }),
    })
    .refine(
      (s) =>
        at(s.requestedAt) <= at(s.claim.claimedAt) &&
        at(s.claim.expiresAt) > at(s.claim.claimedAt) &&
        at(s.claim.expiresAt) - at(s.claim.claimedAt) <=
          billingSyncBounds.leaseMs,
    ),
  z
    .strictObject({
      kind: z.literal('settled'),
      revision,
      observedAt: instant,
      nextAt: instant,
    })
    .refine((s) => at(s.observedAt) <= at(s.nextAt)),
]);
export type BillingSyncState = z.infer<typeof billingSyncStateSchema>;
export type BillingSyncEvent =
  | { readonly kind: 'notify'; readonly newReceipt: boolean }
  | { readonly kind: 'poll' }
  | { readonly kind: 'claim'; readonly claimId: string }
  | {
      readonly kind: 'complete' | 'retry';
      readonly revision: number;
      readonly claimId: string;
    };
export type BillingSyncTransition =
  | { readonly kind: 'refuse' | 'unchanged' }
  | { readonly kind: 'changed'; readonly state: BillingSyncState };
const refuse = { kind: 'refuse' } as const;
const unchanged = { kind: 'unchanged' } as const;
const changed = (state: BillingSyncState): BillingSyncTransition => {
  const parsed = billingSyncStateSchema.safeParse(state);
  return parsed.success ? { kind: 'changed', state: parsed.data } : refuse;
};
const after = (now: string, duration: number) => {
  const value = new Date(at(now) + duration);
  return Number.isFinite(value.getTime()) ? value.toISOString() : null;
};
function due(state: BillingSyncState | null, now: string) {
  return (
    state === null || (state.kind === 'settled' && at(now) >= at(state.nextAt))
  );
}
function notify(state: BillingSyncState | null, now: string) {
  return changed({
    kind: 'pending',
    revision: (state?.revision ?? 0) + 1,
    requestedAt: now,
    retryAt: now,
  });
}
function claim(
  state: BillingSyncState,
  claimId: string,
  now: string,
): BillingSyncTransition {
  if (!idSchema.safeParse(claimId).success || state.kind === 'settled')
    return refuse;
  if (
    state.kind === 'claimed' &&
    (at(now) < at(state.claim.expiresAt) || claimId === state.claim.id)
  )
    return refuse;
  if (state.kind === 'pending' && at(now) < at(state.retryAt)) return refuse;
  const expiresAt = after(now, billingSyncBounds.leaseMs);
  if (!expiresAt) return refuse;
  return changed({
    kind: 'claimed',
    revision: state.revision + (state.kind === 'claimed' ? 1 : 0),
    requestedAt: state.requestedAt,
    claim: { id: claimId, claimedAt: now, expiresAt },
  });
}
function settle(
  state: BillingSyncState,
  event: Extract<BillingSyncEvent, { kind: 'complete' | 'retry' }>,
  now: string,
): BillingSyncTransition {
  if (
    state.kind !== 'claimed' ||
    state.revision !== event.revision ||
    state.claim.id !== event.claimId ||
    at(now) >= at(state.claim.expiresAt)
  )
    return refuse;
  const later = after(
    now,
    event.kind === 'complete'
      ? billingSyncBounds.pollMs
      : billingSyncBounds.retryMs,
  );
  if (!later) return refuse;
  return event.kind === 'complete'
    ? changed({
        kind: 'settled',
        revision: state.revision,
        observedAt: now,
        nextAt: later,
      })
    : changed({
        kind: 'pending',
        revision: state.revision + 1,
        requestedAt: state.requestedAt,
        retryAt: later,
      });
}

function lastTransition(state: BillingSyncState | null): string | null {
  if (!state) return null;
  switch (state.kind) {
    case 'settled':
      return state.observedAt;
    case 'claimed':
      return state.claim.claimedAt;
    case 'pending':
      return state.requestedAt;
  }
}

/** Receipt insertion, mapping/account fences and vendor I/O remain adapter-owned. */
export function advanceBillingSync(
  state: BillingSyncState | null,
  event: BillingSyncEvent,
  now: string,
): BillingSyncTransition {
  if (!instant.safeParse(now).success) return refuse;
  const previous = lastTransition(state);
  if (previous && at(now) < at(previous)) return refuse;
  if (event.kind === 'notify')
    return event.newReceipt ? notify(state, now) : unchanged;
  if (event.kind === 'poll')
    return due(state, now) ? notify(state, now) : unchanged;
  if (!state) return refuse;
  return event.kind === 'claim'
    ? claim(state, event.claimId, now)
    : settle(state, event, now);
}
