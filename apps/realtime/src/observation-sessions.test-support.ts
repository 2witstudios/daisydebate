import {
  observationServerMessageSchema,
  type ObservationBase,
} from '@daisy/protocol';
import type { ObservationBinding } from '@daisy/db/observation';
import { createObservationNode } from './observation-node';
import { observationEvidence } from './observation-permit';
import { createObservationSessions } from './observation-sessions';
import type { ObservationAuthorityReadResult } from './observation-authority';

const channelId = 'c'.repeat(24);
export const request = {
  id: 'request-1',
  resource: { kind: 'channel' as const, id: channelId },
  window: { after: null, limit: 50 },
};
export const base = (disclosureRevision = 1): ObservationBase => ({
  schema: 1,
  resource: request.resource,
  partition: { kind: 'shared', policyKey: 'channel-messages-v1' },
  disclosureRevision,
  window: request.window,
});
const principal = (session = 's'.repeat(24)) => ({
  userId: 'u'.repeat(24),
  actorId: 'a'.repeat(24),
  sessionId: session,
});
type Read = {
  readonly bindings: readonly ObservationBinding[];
  readonly resolve: (
    results: readonly ObservationAuthorityReadResult[],
  ) => void;
};
/** Manual clock, deferred canonical reads and a real node with an inert cache. */
export function sessionsFixture({ maxPerSession = 8 } = {}) {
  let time = 1000;
  const admits: Read[] = [],
    renews: Read[] = [];
  const deferredRead =
    (into: Read[]) => (bindings: readonly ObservationBinding[]) =>
      new Promise<readonly ObservationAuthorityReadResult[]>((resolve) => {
        into.push({ bindings, resolve });
      });
  const node = createObservationNode({
    nodeIncarnation: 'node',
    now: () => time,
    yieldWork: async () => {},
    cache: { demand: async () => {}, read: async () => null },
  });
  const sessions = createObservationSessions({
    now: () => time,
    nodeIncarnation: 'node',
    authority: { admit: deferredRead(admits), renew: deferredRead(renews) },
    node,
    maxPerSession,
  });
  const allowed = (
    view = base(),
    dependencies = [{ key: 'account-x', revision: '1' }],
    overlay: unknown = null,
  ): ObservationAuthorityReadResult => {
    const evidence = observationEvidence({
      started: time,
      remainingMs: 5000,
      fingerprint: 'cohort',
      dependencies,
    });
    return {
      status: 'allowed',
      overlay,
      grant: {
        base: view,
        minimumContentRevision: 1,
        purgeGeneration: 0,
        subject: evidence,
        cohort: evidence,
        entitlement: evidence,
      },
    };
  };
  const socket = (session?: string) => {
    const frames: Record<string, unknown>[] = [];
    const connection = sessions.connect(principal(session), {
      send: (frame) => frames.push(observationServerMessageSchema.parse(frame)),
      sendText: (text) =>
        frames.push(observationServerMessageSchema.parse(JSON.parse(text))),
    });
    return { connection, frames };
  };
  const flush = async () => {
    // Deferred canonical reads stay pending; drain only the microtask chain.
    for (let index = 0; index < 20; index++) await Promise.resolve();
    await node.settled();
    for (let index = 0; index < 20; index++) await Promise.resolve();
  };
  const snapshot = (contentRevision: number, view = base()) =>
    node.accept({
      base: view,
      contentRevision,
      purgeGeneration: 0,
      body: JSON.stringify({ messages: [], continuation: null }),
    });
  return {
    sessions,
    node,
    admits,
    renews,
    allowed,
    socket,
    flush,
    snapshot,
    advance: (ms: number) => {
      time += ms;
    },
  };
}
export const summary = (frames: readonly Record<string, unknown>[]) =>
  frames.map((frame) =>
    frame.type === 'observation.ready'
      ? `ready:${String(frame.generation)}`
      : frame.type === 'observation.snapshot'
        ? `snapshot:${String(frame.generation)}:${String(frame.contentRevision)}`
        : `state:${String(frame.state)}`,
  );
