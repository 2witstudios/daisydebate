import { observationPermitMs } from '@daisy/protocol';

/**
 * Server-internal subscription evidence (ADR 0089, DEC-130). A permit binds
 * one local binding generation to one projection base until a deadline
 * measured from the original read start, never from the response.
 */
export type Permit = {
  readonly generation: number;
  readonly partition: string;
  readonly disclosureRevision: number;
  /** The content floor admission observed: older snapshots are never sent. */
  readonly minimumContentRevision: number;
  /** Monotonic ms. */
  readonly expiresAt: number;
};

/** One evaluator answer per requested principal, from one canonical read. */
export type PermitDecision =
  | {
      readonly status: 'allowed';
      readonly partition: string;
      readonly disclosureRevision: number;
      readonly minimumContentRevision: number;
      /** Earliest monotonic deadline of the session, entitlement and cohort facts read. */
      readonly validUntil: number;
    }
  | { readonly status: 'denied' }
  | { readonly status: 'unavailable' };

/**
 * Expiry is the read start plus the lesser of the facts' own lifetime and
 * the 4,700ms permit bound; a result already past it grants nothing.
 */
export function permitFrom(
  decision: PermitDecision,
  {
    readStart,
    generation,
    now,
  }: {
    readonly readStart: number;
    readonly generation: number;
    readonly now: number;
  },
): Permit | null {
  if (decision.status !== 'allowed') return null;
  const expiresAt = Math.min(
    decision.validUntil,
    readStart + observationPermitMs,
  );
  return expiresAt > now
    ? {
        generation,
        partition: decision.partition,
        disclosureRevision: decision.disclosureRevision,
        minimumContentRevision: decision.minimumContentRevision,
        expiresAt,
      }
    : null;
}

/** A snapshot as the node holds it: one per resource partition. */
export type HeldSnapshot = {
  readonly partition: string;
  readonly disclosureRevision: number;
  readonly contentRevision: number;
};

/**
 * The synchronous final check before every enqueue: the node is serving,
 * the permit belongs to the binding's current generation and is unexpired,
 * and the snapshot is of the permit's exact base, at or above its floor
 * and newer than what this binding already received.
 */
export function mayEnqueue(input: {
  readonly serving: boolean;
  readonly generation: number;
  readonly permit: Permit | null;
  readonly now: number;
  readonly snapshot: HeldSnapshot;
  readonly lastSent: number | null;
}): boolean {
  const { permit, snapshot } = input;
  return (
    input.serving &&
    permit !== null &&
    permit.generation === input.generation &&
    input.now < permit.expiresAt &&
    snapshot.partition === permit.partition &&
    snapshot.disclosureRevision === permit.disclosureRevision &&
    snapshot.contentRevision >= permit.minimumContentRevision &&
    (input.lastSent === null || snapshot.contentRevision > input.lastSent)
  );
}
