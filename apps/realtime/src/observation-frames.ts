import {
  ENVELOPE_VERSION,
  observationResourceKey,
  type ObservationBase,
  type ObservationResource,
  type ObservationServerMessage,
} from '@daisy/protocol';
import type { ObservationBinding } from '@daisy/db/observation';
import type { ObservationGrant } from './observation-permit';
import type { ObservationSnapshot } from './observation-node';

/** Socket-side observation frames and per-recipient helpers. */
export type Principal = ObservationBinding['principal'];
export type Request = {
  readonly id: string;
  readonly resource: ObservationResource;
  readonly window: ObservationBase['window'];
};
export type Outbound = {
  /** Small control frames; validated by the socket. */
  readonly send: (frame: ObservationServerMessage) => void;
  /** Pre-encoded snapshot text; the shared body is validated once per key. */
  readonly sendText: (text: string) => void;
};
export type Recipient = {
  readonly outbound: Outbound;
  readonly request: Request;
  generation: number;
  base: ObservationBase | null;
  closed: boolean;
  release: () => void;
  /** Removes the recipient from its socket once its binding ends. */
  readonly forget: () => void;
};
export const evidenceExpiry = (grant: ObservationGrant) =>
  Math.min(
    grant.subject.expiresAt,
    grant.cohort.expiresAt,
    grant.entitlement.expiresAt,
  );
export const bindingKey = (principal: Principal, request: Request) =>
  JSON.stringify([
    principal.userId,
    principal.actorId,
    principal.sessionId,
    observationResourceKey(request.resource),
    request.window.after,
    request.window.limit,
  ]);
/** Snapshot frames splice the already-encoded shared body; no per-recipient JSON work. */
export function encodeObservationSnapshot(
  id: string,
  generation: number,
  snapshot: ObservationSnapshot,
) {
  const head = JSON.stringify({
    v: ENVELOPE_VERSION,
    type: 'observation.snapshot',
    id,
    generation,
    base: snapshot.base,
    contentRevision: snapshot.contentRevision,
    purgeGeneration: snapshot.purgeGeneration,
  });
  return `${head.slice(0, -1)},"body":${snapshot.body}}`;
}
export function state(
  recipient: Recipient,
  value: 'denied' | 'unavailable' | 'degraded',
) {
  if (recipient.closed) return;
  recipient.outbound.send({
    v: ENVELOPE_VERSION,
    type: 'observation.state',
    id: recipient.request.id,
    generation: recipient.generation,
    resource: recipient.request.resource,
    state: value,
  });
}
export function detach(recipient: Recipient) {
  recipient.release();
  recipient.release = () => {};
  recipient.base = null;
}
