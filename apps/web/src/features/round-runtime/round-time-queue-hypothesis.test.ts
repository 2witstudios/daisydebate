import { assert, setupRitewayBun, test } from 'riteway/bun';
import { driverEdges } from '../resource-sync/driver.test-support';
import { round } from '../room-runtime/operations.test-support';
import type { RoundRead } from './read-round';
import { createMeasuredRead, createRoundTime } from './round-time';
import { createRoundSyncDriver, seedRoundSync } from './round-sync-driver';
import { sampleRoundTime } from './sample-round-time';
setupRitewayBun();

// Models the installed Next Server Function contract: one shared sequential
// dispatch queue. This tests a hypothesis, not the unknown browser cause.
test('an unrelated sequential Server Function can hold actual Round owners stale until released', async () => {
  const edges = driverEdges<RoundRead>();
  const clock = createRoundTime({
    monotonicNowMs: edges.scheduler.now,
    hydrationSeedServerMs: 10000,
  });
  let tail: Promise<unknown> = Promise.resolve();
  const dispatch = <T>(job: () => Promise<T>) => {
    const result = tail.then(job);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  let generation = 0;
  const starts: { generation: number; sentAtMs: number; owner: string }[] = [];
  let owner = 'sampler';
  const measured = createMeasuredRead({
    roundTime: clock,
    monotonicNowMs: edges.scheduler.now,
    nextGeneration: () => {
      const next = ++generation;
      starts.push({ generation: next, sentAtMs: edges.scheduler.now(), owner });
      return next;
    },
    read: () => dispatch(edges.read),
  });
  const read = (signal?: AbortSignal) => {
    owner = signal ? 'sampler' : 'resource';
    return measured(signal);
  };
  const stop = sampleRoundTime({
    ...edges,
    visibility: { isVisible: () => true, onVisible: () => () => {} },
    roundTime: clock,
    read,
  });
  await edges.flush();
  const answer = () =>
    edges.answer({
      kind: 'found',
      round,
      serverNowMs: 10000 + edges.scheduler.now() - 1000,
      socketUrl: null,
    });
  answer();
  await edges.flush();
  const driver = createRoundSyncDriver({
    ...edges,
    seed: seedRoundSync(round, edges.scheduler.now()),
    read,
  });
  driver.signal();
  await edges.flush();
  edges.advance(2461);
  answer();
  await edges.flush();
  const anchor = clock.calibration();
  const unrelated = Promise.withResolvers<void>();
  const unrelatedStarted = Promise.withResolvers<void>();
  const action = dispatch(async () => {
    unrelatedStarted.resolve();
    await unrelated.promise;
  });
  await unrelatedStarted.promise;
  edges.show();
  edges.advance(2000);
  await edges.flush();
  edges.advance(10000);
  await edges.flush();
  assert({
    given:
      'a refused 2461ms sample, an unrelated pending action, then visibility/poll/sampler wakes',
    should:
      'keep the accepted anchor and visibly stale status without unbounded read dispatch',
    actual: [
      clock.status().kind,
      clock.calibration(),
      edges.reads(),
      starts.slice(-2).map(({ generation, owner }) => [generation, owner]),
    ],
    expected: [
      'stale',
      anchor,
      2,
      [
        [3, 'resource'],
        [4, 'sampler'],
      ],
    ],
  });
  unrelated.resolve();
  await action;
  await edges.flush();
  // Resolve only the bounded queued reads; their measured RTT includes time
  // in the unrelated queue, then a coalesced fresh resource read can recover.
  let answered = 2;
  for (let attempt = 0; attempt < 5 && edges.reads() > answered; attempt++) {
    answer();
    answered++;
    await edges.flush();
  }
  assert({
    given: 'the unrelated queue head is released and actual reads complete',
    should:
      'recover through a fresh generation on the same Round and the same clock',
    actual: [
      clock.status().kind,
      clock.calibration()?.generation,
      driver.readSnapshot().value.id,
      edges.reads() <= 5,
    ],
    expected: ['current', 5, round.id, true],
  });
  driver.dispose();
  stop();
  assert({
    given: 'both actual owners disposed',
    should: 'leave no timers behind',
    actual: edges.timers(),
    expected: [],
  });
});
