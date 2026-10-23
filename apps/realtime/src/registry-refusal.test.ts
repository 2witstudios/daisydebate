import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixture, row, topic } from './registry.test-support';

setupRitewayBun();

for (const outcome of ['denied', 'unavailable'] as const)
  test(`a subscription whose authority read is ${outcome}`, async () => {
    const failure = new Error('connection reset');
    const failures: unknown[] = [];
    const { registry, connection, sent } = fixture({
      authorize: async () => {
        if (outcome === 'unavailable') throw failure;
        return null;
      },
      failed: (error) => {
        failures.push(error);
      },
    });
    await registry.subscribe(connection, { id: 'request', topic });
    assert({
      given: `an authority read that ${outcome === 'denied' ? 'denies the principal' : 'throws'}`,
      should:
        outcome === 'denied'
          ? 'refuse with AUTHORIZATION and report nothing'
          : 'refuse with the transient INFRASTRUCTURE code and report the failure',
      actual: {
        codes: sent.map((frame) =>
          frame.type === 'error' ? frame.code : frame.type,
        ),
        failures,
      },
      expected: {
        codes: [outcome === 'denied' ? 'AUTHORIZATION' : 'INFRASTRUCTURE'],
        failures: outcome === 'denied' ? [] : [failure],
      },
    });
  });

for (const fenced of [2, 4])
  test(`a first authority read fenced by writes ${fenced} times in a row`, async () => {
    let reads = 0;
    let sink: (rows: ReturnType<typeof row>[]) => void = () => {};
    const { registry, connection, sent } = fixture({
      authorize: async () => {
        reads += 1;
        // A write lands on the topic while this read is in flight.
        if (reads <= fenced) sink([row(reads + 1)]);
        return { revision: '1', validUntil: 60_000 };
      },
    });
    sink = (rows) => registry.sink(rows);
    registry.seed({ txid: '1', seq: 1n });
    await registry.subscribe(connection, { id: 'request', topic });
    assert({
      given: `allowed reads, each of the first ${fenced} overlapped by a write`,
      should:
        fenced < 3
          ? 're-read in place and subscribe, without a client round trip'
          : 'stop after three fenced reads and ask the subscriber to resynchronize',
      actual: {
        frames: sent.map((frame) =>
          frame.type === 'error' ? frame.code : frame.type,
        ),
        reads,
      },
      expected:
        fenced < 3
          ? { frames: ['subscribed'], reads: fenced + 1 }
          : { frames: ['resync_required'], reads: 3 },
    });
  });

test('an event whose delivery authority read is unavailable asks the subscriber to resynchronize', async () => {
  let failing = false;
  const { registry, connection, sent } = fixture({
    authorize: async () => {
      if (failing) throw new Error('connection reset');
      return { revision: '1', validUntil: 60_000 };
    },
  });
  registry.seed({ txid: '1', seq: 1n });
  await registry.subscribe(connection, { id: 'request', topic });
  failing = true;
  registry.sink([row(2)]);
  await registry.settled();
  assert({
    given: 'an attached subscription whose next delivery authority read fails',
    should:
      'answer resync_required for its subscribe request instead of dropping the event silently (ISSUE-445-r2)',
    actual: sent.map((frame) =>
      frame.type === 'resync_required' ? `resync:${frame.id}` : frame.type,
    ),
    expected: ['subscribed', 'resync:request'],
  });
});
