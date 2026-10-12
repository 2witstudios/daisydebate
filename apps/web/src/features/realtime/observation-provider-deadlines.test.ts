import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createObservationProvider } from './observation-provider';
import type { ObservationServerMessage } from '@daisy/protocol';
setupRitewayBun();
test('logout transport loss fences a late snapshot immediately', () => {
  let stateChange!: (state: {
    status: 'closed';
    generation: number;
    terminal: null;
  }) => void;
  let incoming!: (frame: ObservationServerMessage) => void;
  const provider = createObservationProvider({
    connection: {
      connect: () => {},
      dispose: () => {},
      subscribe: (listener) => {
        stateChange = listener;
        return () => {};
      },
      observe: (_descriptor, listener) => {
        incoming = listener;
        return () => {};
      },
    },
    scheduler: { now: () => 0, setTimeout: () => 0, clearTimeout: () => {} },
  });
  const descriptor = {
    resource: { kind: 'channel', id: 'a'.repeat(24) },
    window: { after: null, limit: 50 },
    schema: 'channel-v1',
    decode: (body: unknown) => (typeof body === 'string' ? body : null),
  } as const;
  const reader = provider.observe(descriptor),
    base = {
      schema: 1,
      resource: descriptor.resource,
      window: descriptor.window,
      partition: { kind: 'shared', policyKey: 'v1' },
      disclosureRevision: 1,
    } as const;
  incoming({
    v: 1 as never,
    type: 'observation.ready',
    id: 'id',
    generation: 1,
    base,
    minimumContentRevision: 1,
    validForMs: 4900,
    overlay: null,
  });
  incoming({
    v: 1 as never,
    type: 'observation.snapshot',
    id: 'id',
    generation: 1,
    base,
    contentRevision: 1,
    purgeGeneration: 0,
    body: 'private',
  });
  stateChange({ status: 'closed', generation: 1, terminal: null });
  incoming({
    v: 1 as never,
    type: 'observation.snapshot',
    id: 'id',
    generation: 1,
    base,
    contentRevision: 999,
    purgeGeneration: 0,
    body: 'late',
  });
  assert({
    given: 'logout/closed transport while content and permission timer remain',
    should: 'hide immediately and refuse delayed larger-version results',
    actual: reader.read().content,
    expected: null,
  });
  provider.dispose();
});

test('reading after elapsed permission hides despite a delayed timer', () => {
  let now = 0,
    incoming!: (frame: ObservationServerMessage) => void;
  const provider = createObservationProvider({
    connection: {
      connect: () => {},
      dispose: () => {},
      subscribe: () => () => {},
      observe: (_descriptor, listener) => {
        incoming = listener;
        return () => {};
      },
    },
    scheduler: { now: () => now, setTimeout: () => 0, clearTimeout: () => {} },
  });
  const descriptor = {
    resource: { kind: 'channel', id: 'a'.repeat(24) },
    window: { after: null, limit: 50 },
    schema: 'channel-v1',
    decode: (body: unknown) => (typeof body === 'string' ? body : null),
  } as const;
  const reader = provider.observe(descriptor),
    base = {
      schema: 1,
      resource: descriptor.resource,
      window: descriptor.window,
      partition: { kind: 'shared', policyKey: 'v1' },
      disclosureRevision: 1,
    } as const;
  incoming({
    v: 1 as never,
    type: 'observation.ready',
    id: 'id',
    generation: 1,
    base,
    minimumContentRevision: 1,
    validForMs: 100,
    overlay: null,
  });
  incoming({
    v: 1 as never,
    type: 'observation.snapshot',
    id: 'id',
    generation: 1,
    base,
    contentRevision: 1,
    purgeGeneration: 0,
    body: 'private',
  });
  now = 101;
  const release = reader.subscribe(() => reader.read());
  assert({
    given: 'the clock passes expiry before the scheduled timer executes',
    should: 'synchronously hide on read, independent of timer timing',
    actual: reader.read().content,
    expected: null,
  });
  incoming({
    v: 1 as never,
    type: 'observation.ready',
    id: 'id',
    generation: 2,
    base,
    minimumContentRevision: 1,
    validForMs: 100,
    overlay: null,
  });
  incoming({
    v: 1 as never,
    type: 'observation.snapshot',
    id: 'id',
    generation: 2,
    base,
    contentRevision: 1,
    purgeGeneration: 0,
    body: 'private',
  });
  assert({
    given:
      'a synchronous snapshot reader reenters during fresh authorization after expiry',
    should:
      'restore unchanged content under the fresh deadline without invalidating its attempt',
    actual: reader.read().content,
    expected: 'private',
  });
  release();
  provider.dispose();
});
