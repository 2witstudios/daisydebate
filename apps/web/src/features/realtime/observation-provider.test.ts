import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createObservationProvider } from './observation-provider';
import type { ObservationServerMessage } from '@daisy/protocol';
setupRitewayBun();
test('provider owns one connection, reference counts and final deadline hiding', () => {
  let now = 0,
    connects = 0,
    disposals = 0;
  const callbacks = new Set<(frame: ObservationServerMessage) => void>(),
    timers = new Map<number, () => void>();
  const provider = createObservationProvider({
    connection: {
      connect: () => {
        connects++;
      },
      dispose: () => {
        disposals++;
      },
      subscribe: () => () => {},
      observe: (_descriptor, listener) => {
        callbacks.add(listener);
        return () => {
          callbacks.delete(listener);
        };
      },
    },
    scheduler: {
      now: () => now,
      setTimeout: (cb) => {
        timers.set(timers.size + 1, cb);
        return timers.size;
      },
      clearTimeout: (id) => {
        timers.delete(id as number);
      },
    },
  });
  const descriptor = {
    resource: { kind: 'channel', id: 'a'.repeat(24) },
    window: { after: null, limit: 50 },
    schema: 'channel-v1',
    decode: (body: unknown) => (typeof body === 'string' ? body : null),
  } as const;
  const first = provider.observe(descriptor),
    second = provider.observe(descriptor);
  const base = {
    schema: 1,
    resource: descriptor.resource,
    window: descriptor.window,
    partition: { kind: 'shared', policyKey: 'v1' },
    disclosureRevision: 1,
  } as const;
  for (const callback of callbacks) {
    callback({
      v: 1 as never,
      type: 'observation.ready',
      id: 'id',
      generation: 1,
      base,
      minimumContentRevision: 1,
      validForMs: 100,
    });
    callback({
      v: 1 as never,
      type: 'observation.snapshot',
      id: 'id',
      generation: 1,
      base,
      contentRevision: 1,
      purgeGeneration: 0,
      body: 'shared',
    });
  }
  first.close();
  const visible = second.read().content;
  now = 100;
  for (const callback of [...timers.values()]) callback();
  const hidden = second.read().content;
  provider.dispose();
  provider.dispose();
  assert({
    given: 'two readers and elapsed authority followed by final disposal',
    should:
      'share a single connection/interest, hide at deadline, release every resource once',
    actual: {
      connects,
      disposals,
      visible,
      hidden,
      callbacks: callbacks.size,
      timers: timers.size,
    },
    expected: {
      connects: 1,
      disposals: 1,
      visible: 'shared',
      hidden: null,
      callbacks: 0,
      timers: 0,
    },
  });
});

test('correlated reconnect can install a lower generation from a new server incarnation', async () => {
  const { createObservationSubscriptions } =
    await import('./observation-subscriptions');
  const sent: { id: string }[] = [];
  const subscriptions = createObservationSubscriptions({
    now: () => 0,
    send: (frame) => sent.push(frame as { id: string }),
  });
  const provider = createObservationProvider({
    connection: {
      connect: () => {},
      dispose: () => subscriptions.dispose(),
      subscribe: () => () => {},
      observe: subscriptions.observe,
    },
    scheduler: { now: () => 0, setTimeout: () => 0, clearTimeout: () => {} },
  });
  const descriptor = {
    resource: { kind: 'channel', id: 'a'.repeat(24) },
    window: { after: null, limit: 50 },
    schema: 'channel-v1',
    decode: (body: unknown) => (typeof body === 'string' ? body : null),
  } as const;
  const reader = provider.observe(descriptor);
  const base = {
    schema: 1,
    resource: descriptor.resource,
    window: descriptor.window,
    partition: { kind: 'shared', policyKey: 'v1' },
    disclosureRevision: 1,
  } as const;
  const send = (generation: number, revision: number, body: string) => {
    const id = sent.at(-1)!.id;
    subscriptions.emit({
      v: 1 as never,
      type: 'observation.ready',
      id,
      generation,
      base,
      minimumContentRevision: revision,
      validForMs: 4900,
    });
    subscriptions.emit({
      v: 1 as never,
      type: 'observation.snapshot',
      id,
      generation,
      base,
      contentRevision: revision,
      purgeGeneration: 0,
      body,
    });
  };
  send(7, 1, 'old');
  const oldRequest = sent.at(-1)!.id;
  subscriptions.reconnect();
  send(0, 2, 'current');
  subscriptions.emit({
    v: 1 as never,
    type: 'observation.snapshot',
    id: oldRequest,
    generation: 99,
    base,
    contentRevision: 999,
    purgeGeneration: 0,
    body: 'stale-incarnation',
  });
  assert({
    given: 'new request ID and a replacement server starting generation zero',
    should: 'fence the prior request and install current authorized baseline',
    actual: reader.read().content,
    expected: 'current',
  });
  provider.dispose();
});

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
