import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingPressure } from '../e2e/support/messaging-pressure';
setupRitewayBun();

test('a failed entrant releases peers and retains ownership until every holder settles', async () => {
  const first = Promise.withResolvers<void>();
  const slowCleanup = Promise.withResolvers<void>();
  const slowReleased = Promise.withResolvers<void>();
  const secondEntered = Promise.withResolvers<void>();
  const fault = new Error('controlled entrant failure');
  let calls = 0;
  let targets = 0;
  const pressure = createMessagingPressure(
    async (_scope: undefined, work) => {
      const call = ++calls;
      if (call === 1) return first.promise;
      await work();
      if (call === 2) {
        slowReleased.resolve();
        await slowCleanup.promise;
      }
      if (call === 8) secondEntered.resolve();
    },
    () => {},
  );
  const one = pressure(undefined, async () => {
    targets += 1;
  });
  let firstSettled = false;
  const observedOne = one
    .catch((error: unknown) => error)
    .finally(() => {
      firstSettled = true;
    });
  first.reject(fault);
  await slowReleased.promise;
  const two = pressure(undefined, async () => {
    targets += 1;
  });
  // One task boundary drains the queued settlement continuations; no time delay.
  await new Promise<void>((resolve) => setImmediate(resolve));
  let error: unknown;
  try {
    assert({
      given: 'one entrant rejected and a released peer has not settled',
      should:
        'release the barrier promptly but admit no second pressure owner or target',
      actual: { calls, targets, firstSettled },
      expected: { calls: 4, targets: 0, firstSettled: false },
    });
  } finally {
    slowCleanup.resolve();
    error = await observedOne;
    await two;
  }
  await secondEntered.promise;
  assert({
    given: 'every first-owner holder has now settled',
    should: 'preserve the entrant fault and admit the next owner once',
    actual: {
      errors: error instanceof AggregateError ? error.errors : [],
      calls,
      targets,
    },
    expected: { errors: [fault], calls: 8, targets: 1 },
  });
});

test('target failure and holder cleanup failure remain distinct and unretried', async () => {
  const targetFault = new Error('controlled target failure');
  const cleanupFault = new Error('controlled cleanup failure');
  let calls = 0;
  let targets = 0;
  const diagnostics: unknown[] = [];
  const pressure = createMessagingPressure(
    async (_scope: undefined, work) => {
      const call = ++calls;
      await work();
      if (call === 1) throw cleanupFault;
    },
    (sample) => diagnostics.push(sample),
  );
  const error = await pressure(undefined, async () => {
    targets += 1;
    throw targetFault;
  }).catch((error: unknown) => error);
  assert({
    given: 'the real target failed and one released holder also failed',
    should:
      'retain both failures with separate safe stage outcomes and never retry the target',
    actual: {
      errors: error instanceof AggregateError ? error.errors : [],
      calls,
      targets,
      stages: diagnostics,
    },
    expected: {
      errors: [targetFault, cleanupFault],
      calls: 4,
      targets: 1,
      stages: [
        { stage: 'setup', entered: 4, result: 'ready', faults: 0 },
        { stage: 'target', entered: 4, result: 'failed', faults: 1 },
        { stage: 'release', entered: 4, result: 'failed', faults: 1 },
      ],
    },
  });
});

test('a target-only failure retains the exact original error after all holders settle', async () => {
  const targetFault = new Error('controlled target refusal');
  let targets = 0;
  let settled = 0;
  const pressure = createMessagingPressure(
    async (_scope: undefined, work) => {
      await work();
      settled += 1;
    },
    () => {},
  );
  const error = await pressure(undefined, async () => {
    targets += 1;
    throw targetFault;
  }).catch((error: unknown) => error);
  assert({
    given:
      'only the actual protected target refused and its four holders released normally',
    should:
      'preserve its identity without a wrapper or retry and return only after cleanup',
    actual: { original: error === targetFault, targets, settled },
    expected: { original: true, targets: 1, settled: 4 },
  });
});
