import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { ObservationResource } from '@daisy/protocol';
import { createFanout } from './fanout';
import { createObservationNode, type ObservationConnection } from './node';
import type { PermitDecision } from './permits';
import { defineObservableResources } from './resources';

setupRitewayBun();
const id = 'c'.repeat(24);
const resource: ObservationResource = { kind: 'channel-messages', id };
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};

function harness({
  viewers = 1,
  decide = (): PermitDecision => ({
    status: 'allowed',
    partition: 'members',
    disclosureRevision: 1,
    minimumContentRevision: 0,
    validUntil: Number.MAX_SAFE_INTEGER,
  }),
}: {
  viewers?: number;
  decide?: (actorId: string) => PermitDecision;
} = {}) {
  // Fractional, like performance.now() in production.
  let clock = 1_000.25;
  const calls = {
    permits: [] as { principals: number; lane: string }[],
    reads: 0,
    interests: 0,
    subscribes: 0,
    yields: 0,
  };
  const gate = { closed: false, waiting: [] as ((value: unknown) => void)[] };
  const stored = new Map<
    string,
    { disclosureRevision: number; contentRevision: number; body: string }
  >();
  const store = (contentRevision: number, disclosureRevision = 1) =>
    stored.set('members', {
      disclosureRevision,
      contentRevision,
      body: JSON.stringify({ contentRevision }),
    });
  const node = createObservationNode({
    node: 'node-a',
    now: () => clock,
    resources: defineObservableResources([
      {
        kind: 'channel-messages',
        readHeaders: async () => new Map(),
        project: async () => null,
        parseBody: (body) => body,
        evaluatePermits: async ({ principals, lane }) => {
          calls.permits.push({ principals: principals.length, lane });
          return principals.map((p) => decide(p.actorId));
        },
      },
    ]),
    cache: {
      readObservation: async (_r, partition) => {
        calls.reads++;
        // Snapshot the store now; a gated read answers it later.
        const answer = stored.get(partition) ?? null;
        if (gate.closed)
          await new Promise((resolve) => gate.waiting.push(resolve));
        return answer;
      },
      readObservationHeads: async (entries) =>
        entries.map(() => ({
          owned: true,
          disclosureRevision: stored.get('members')?.disclosureRevision ?? null,
          contentRevision: stored.get('members')?.contentRevision ?? null,
        })),
      refreshObservationInterest: async ({ resources }) => {
        calls.interests++;
        return resources.map(() => true);
      },
      withdrawObservationInterest: async () => {},
    },
    subscriber: {
      observe: async () => {
        calls.subscribes++;
        return true;
      },
      forget: async () => {},
    },
    fanout: createFanout({
      now: () => clock,
      yieldNow: async () => {
        calls.yields++;
        await onYield();
      },
    }),
  });
  const connections = Array.from({ length: viewers }, (_, index) => {
    const frames: Record<string, unknown>[] = [];
    const connection: ObservationConnection = {
      principal: {
        actorId: `actor${String(index).padStart(19, '0')}`,
        userId: 'u'.repeat(24),
        sessionId: 's'.repeat(24),
      },
      sendText: (text) => {
        frames.push(JSON.parse(text));
        return true;
      },
    };
    return { connection, frames };
  });
  let onYield: () => Promise<void> | void = () => {};
  return {
    node,
    calls,
    store,
    gate,
    setOnYield: (hook: () => Promise<void> | void) => {
      onYield = hook;
    },
    clear: () => stored.clear(),
    connections,
    advance: (ms: number) => {
      clock += ms;
    },
    observeAll: () =>
      connections.map(({ connection }, index) =>
        node.observe(connection, { id: `o-${index}`, resource }),
      ),
    types: (index: number) =>
      connections[index]!.frames.map((f) =>
        f.type === 'observation.snapshot'
          ? `snapshot:${f.contentRevision}`
          : f.type === 'observation.state'
            ? `state:${f.state}`
            : String(f.type),
      ),
  };
}

describe('observation node cardinality', () => {
  test('500 viewers, one revision', async () => {
    const h = harness({ viewers: 500 });
    h.observeAll();
    await settle();
    h.store(4);
    h.node.hint(resource, {
      kind: 'published',
      partition: 'members',
      disclosureRevision: 1,
      contentRevision: 4,
    });
    h.node.hint(resource, {
      kind: 'published',
      partition: 'members',
      disclosureRevision: 1,
      contentRevision: 4,
    });
    await settle();
    const snapshots = h.connections.filter(({ frames }) =>
      frames.some((f) => f.type === 'observation.snapshot'),
    ).length;
    assert({
      given:
        '500 local viewers joining one resource and two hints for one revision',
      should:
        'register one interest and one subscription, admit them in one batched read, fetch the body once and send it to every viewer, yielding every 128 sends',
      actual: {
        interests: h.calls.interests,
        subscribes: h.calls.subscribes,
        permits: h.calls.permits,
        snapshots,
        yields: h.calls.yields >= 3,
      },
      expected: {
        interests: 1,
        subscribes: 1,
        permits: [{ principals: 500, lane: 'admission' }],
        snapshots: 500,
        yields: true,
      },
    });
    // The two admissions fetched nothing (empty store); the hint fetched once.
    assert({
      given: 'concurrent fetches of one revision',
      should: 'read Redis at most once per admission miss plus once per hint',
      actual: h.calls.reads <= 2,
      expected: true,
    });
  });
});

describe('observation node authority', () => {
  test('revocation at renewal', async () => {
    let allowed = true;
    const h = harness({
      decide: () =>
        allowed
          ? {
              status: 'allowed',
              partition: 'members',
              disclosureRevision: 1,
              minimumContentRevision: 0,
              validUntil: Number.MAX_SAFE_INTEGER,
            }
          : { status: 'denied' },
    });
    h.store(1);
    h.observeAll();
    await settle();
    allowed = false;
    h.advance(3_000);
    h.node.renew();
    await settle();
    h.store(2);
    h.node.hint(resource, {
      kind: 'published',
      partition: 'members',
      disclosureRevision: 1,
      contentRevision: 2,
    });
    await settle();
    assert({
      given: 'a viewer whose renewal is denied, then a new revision',
      should: 'report revoked and send nothing more',
      actual: h.types(0),
      expected: ['observation.ready', 'snapshot:1', 'state:revoked'],
    });
  });
  test('no enqueue past the permit deadline', async () => {
    let available = true;
    const h = harness({
      decide: () =>
        available
          ? {
              status: 'allowed',
              partition: 'members',
              disclosureRevision: 1,
              minimumContentRevision: 0,
              validUntil: Number.MAX_SAFE_INTEGER,
            }
          : { status: 'unavailable' },
    });
    h.observeAll();
    await settle();
    available = false;
    h.advance(4_699);
    h.node.renew();
    await settle();
    h.store(3);
    h.node.hint(resource, {
      kind: 'published',
      partition: 'members',
      disclosureRevision: 1,
      contentRevision: 3,
    });
    await settle();
    const before = h.types(0);
    h.advance(1);
    h.store(4);
    h.node.hint(resource, {
      kind: 'published',
      partition: 'members',
      disclosureRevision: 1,
      contentRevision: 4,
    });
    await settle();
    h.node.renew();
    await settle();
    assert({
      given:
        'renewal unavailable, a revision 1ms before expiry and one at expiry',
      should:
        'keep the unexpired permit usable, refuse the enqueue at 4,700ms after the read start, and report the lapse once',
      actual: [before, h.types(0)],
      expected: [
        ['observation.ready', 'snapshot:3'],
        ['observation.ready', 'snapshot:3', 'state:unavailable'],
      ],
    });
  });
  test('disclosure change re-admits before delivery', async () => {
    let disclosure = 1;
    const h = harness({
      decide: () => ({
        status: 'allowed',
        partition: 'members',
        disclosureRevision: disclosure,
        minimumContentRevision: 0,
        validUntil: Number.MAX_SAFE_INTEGER,
      }),
    });
    h.store(1);
    h.observeAll();
    await settle();
    disclosure = 2;
    h.store(2, 2);
    h.node.hint(resource, {
      kind: 'published',
      partition: 'members',
      disclosureRevision: 2,
      contentRevision: 2,
    });
    await settle();
    assert({
      given: 'an authority change publishing a new disclosure revision',
      should:
        'withhold the new base from the old permit, re-admit on the renewal lane, then deliver',
      actual: [h.types(0), h.calls.permits.map((p) => p.lane)],
      expected: [
        ['observation.ready', 'snapshot:1', 'observation.ready', 'snapshot:2'],
        ['admission', 'renewal'],
      ],
    });
  });
  test('content floor', async () => {
    const h = harness({
      decide: () => ({
        status: 'allowed',
        partition: 'members',
        disclosureRevision: 1,
        minimumContentRevision: 5,
        validUntil: Number.MAX_SAFE_INTEGER,
      }),
    });
    h.store(4);
    h.observeAll();
    await settle();
    h.store(5);
    h.node.hint(resource, {
      kind: 'published',
      partition: 'members',
      disclosureRevision: 1,
      contentRevision: 5,
    });
    await settle();
    assert({
      given: 'a cached body older than the revision admission observed',
      should: 'wait for the shared rebuild instead of sending it',
      actual: h.types(0),
      expected: ['observation.ready', 'snapshot:5'],
    });
  });
  test('re-observe fences the old generation', async () => {
    const h = harness();
    h.store(1);
    const { connection } = h.connections[0]!;
    h.node.observe(connection, { id: 'first', resource });
    h.node.observe(connection, { id: 'second', resource });
    await settle();
    const ready = h.connections[0]!.frames.filter(
      (f) => f.type === 'observation.ready',
    );
    assert({
      given: 'a socket observing the same resource twice in one tick',
      should: 'answer only the latest request generation',
      actual: ready.map((f) => f.id),
      expected: ['second'],
    });
  });
  test('fenced actor', async () => {
    const h = harness({ viewers: 2 });
    h.store(1);
    h.observeAll();
    await settle();
    h.node.fenceActor(h.connections[0]!.connection.principal.actorId);
    h.store(2);
    h.node.hint(resource, {
      kind: 'published',
      partition: 'members',
      disclosureRevision: 1,
      contentRevision: 2,
    });
    await settle();
    assert({
      given: 'a control fence for one actor',
      should: 'stop that actor synchronously and re-read only their permit',
      actual: h.calls.permits,
      expected: [
        { principals: 2, lane: 'admission' },
        { principals: 1, lane: 'renewal' },
      ],
    });
  });
  test('last viewer leaves', async () => {
    const h = harness({ viewers: 2 });
    h.observeAll();
    await settle();
    h.node.disconnect(h.connections[0]!.connection);
    const one = h.node.stats();
    h.node.unobserve(h.connections[1]!.connection, resource);
    assert({
      given: 'both viewers leaving',
      should: 'keep the resource until the last one, then release it',
      actual: [one, h.node.stats()],
      expected: [
        { resources: 1, bindings: 1, heldBytes: 0 },
        { resources: 0, bindings: 0, heldBytes: 0 },
      ],
    });
  });
});

test('a fractional fact deadline still yields a whole-millisecond ready', async () => {
  const h = harness({
    decide: () => ({
      status: 'allowed',
      partition: 'members',
      disclosureRevision: 1,
      minimumContentRevision: 0,
      // A session expiry mapped onto performance.now() is rarely whole.
      validUntil: 1_000.25 + 3_000.7,
    }),
  });
  h.observeAll();
  await settle();
  const ready = h.connections[0]!.frames.find(
    (frame) => frame.type === 'observation.ready',
  );
  assert({
    given: 'facts that expire at a fractional monotonic instant',
    should:
      'promise the browser the floored lifetime, never longer than the permit',
    actual: ready?.validForMs,
    expected: 3_000,
  });
});

describe('observation node purge fence', () => {
  const published = (contentRevision: number) =>
    ({
      kind: 'published',
      partition: 'members',
      disclosureRevision: 1,
      contentRevision,
    }) as const;
  test('a body read before a purge is never sent after it', async () => {
    const h = harness();
    h.observeAll();
    await settle();
    h.store(3);
    h.gate.closed = true;
    h.node.hint(resource, published(3));
    await settle();
    h.clear();
    h.node.hint(resource, { kind: 'purged' });
    h.gate.closed = false;
    for (const release of h.gate.waiting.splice(0)) release(undefined);
    await settle();
    assert({
      given: 'a delayed pre-purge body read that resolves after the purge',
      should: 'send nothing from it',
      actual: h.types(0),
      expected: ['observation.ready'],
    });
  });
  test('a fanout yielding across a purge stops sending the purged body', async () => {
    const h = harness({ viewers: 300 });
    h.observeAll();
    await settle();
    let purged = false;
    h.setOnYield(() => {
      if (purged) return;
      purged = true;
      // A real purge deletes the Redis bodies before its hint.
      h.clear();
      h.node.hint(resource, { kind: 'purged' });
    });
    h.store(4);
    h.node.hint(resource, published(4));
    await settle();
    const sent = h.connections.filter(({ frames }) =>
      frames.some((frame) => frame.type === 'observation.snapshot'),
    ).length;
    assert({
      given: "300 viewers and a purge arriving at the fanout's first yield",
      should:
        'stop at the yield: only the first slice of 128 got the purged body',
      actual: sent,
      expected: 128,
    });
  });
});
