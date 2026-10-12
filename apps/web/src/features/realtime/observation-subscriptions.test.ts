import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createObservationSubscriptions } from './observation-subscriptions';
import type { ObservationServerMessage } from '@daisy/protocol';
setupRitewayBun();
test('one interest owns wire subscription and second observer gets acknowledged baseline', () => {
  const sent: object[] = [],
    first: string[] = [],
    second: string[] = [];
  const subscriptions = createObservationSubscriptions({
    now: () => 0,
    send: (frame) => sent.push(frame),
  });
  const descriptor = {
    resource: { kind: 'channel', id: 'a'.repeat(24) },
    window: { after: null, limit: 50 },
  } as const;
  const release = subscriptions.observe(descriptor, (frame) =>
    first.push(frame.type),
  );
  const id = (sent[0] as { id: string }).id;
  const base = {
    schema: 1,
    ...descriptor,
    partition: { kind: 'shared', policyKey: 'v1' },
    disclosureRevision: 1,
  } as const;
  const ready: ObservationServerMessage = {
    v: 1 as never,
    type: 'observation.ready',
    id,
    generation: 1,
    base,
    minimumContentRevision: 1,
    validForMs: 4900,
  };
  const snapshot: ObservationServerMessage = {
    v: 1 as never,
    type: 'observation.snapshot',
    id,
    generation: 1,
    base,
    contentRevision: 1,
    purgeGeneration: 0,
    body: 'current',
  };
  subscriptions.emit(ready);
  subscriptions.emit(snapshot);
  const other = subscriptions.observe(descriptor, (frame) =>
    second.push(frame.type),
  );
  release();
  const before = sent.length;
  other();
  assert({
    given: 'two observers of an acknowledged resource',
    should:
      'share one wire interest, baseline the second immediately, unobserve only after final release',
    actual: { before, sent: sent.length, first, second },
    expected: {
      before: 1,
      sent: 2,
      first: ['observation.ready', 'observation.snapshot'],
      second: ['observation.ready', 'observation.snapshot'],
    },
  });
});

test('cached ACK never grants a new listener another full lifetime', () => {
  let now = 0;
  const sent: { id: string }[] = [];
  const subscriptions = createObservationSubscriptions({
    send: (frame) => sent.push(frame as { id: string }),
    now: () => now,
  });
  const descriptor = {
    resource: { kind: 'channel', id: 'a'.repeat(24) },
    window: { after: null, limit: 50 },
  } as const;
  subscriptions.observe(descriptor, () => {});
  const base = {
    schema: 1,
    ...descriptor,
    partition: { kind: 'shared', policyKey: 'v1' },
    disclosureRevision: 1,
  } as const;
  subscriptions.emit({
    v: 1 as never,
    type: 'observation.ready',
    id: sent[0]!.id,
    generation: 1,
    base,
    minimumContentRevision: 1,
    validForMs: 100,
  });
  now = 75;
  let remaining = 0;
  subscriptions.observe(descriptor, (frame) => {
    if (frame.type === 'observation.ready') remaining = frame.validForMs;
  });
  now = 100;
  let expired = 0;
  subscriptions.observe(descriptor, () => {
    expired++;
  });
  assert({
    given:
      'a second and then expired listener joining an acknowledged interest',
    should:
      'retain original ACK deadline rather than restart authority from arrival',
    actual: { remaining, expired },
    expected: { remaining: 25, expired: 0 },
  });
});
