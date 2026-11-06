import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingPressure } from '../e2e/support/messaging-pressure';
setupRitewayBun();
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
const clock = () => {
  let expire = () => {};
  return {
    schedule: (run: () => void) => {
      expire = run;
      return () => {};
    },
    fire: () => expire(),
  };
};

test('preparation acknowledges all four actual entrants before any target operation', async () => {
  const fourth = Promise.withResolvers<void>();
  const timer = clock();
  let calls = 0,
    acknowledged = false,
    targets = 0,
    settled = 0;
  const pressure = createMessagingPressure(
    async (_scope: string, work) => {
      calls += 1;
      if (calls === 4) await fourth.promise;
      await work();
      settled += 1;
    },
    () => {},
    timer.schedule,
  );
  const preparation = pressure.prepare('fresh selectors').then(() => {
    acknowledged = true;
  });
  await turn();
  const premature = await pressure
    .target(async () => {
      targets += 1;
    })
    .catch(() => 'refused');
  assert({
    given: 'three entered holders and one delayed actual authority',
    should: 'withhold acknowledgment and never invoke a premature target',
    actual: { calls, acknowledged, targets, premature },
    expected: {
      calls: 4,
      acknowledged: false,
      targets: 0,
      premature: 'refused',
    },
  });
  fourth.resolve();
  await preparation;
  await pressure.target(async () => {
    targets += 1;
  });
  await pressure.allow();
  assert({
    given: 'all four holders entered, then one target and explicit allow',
    should: 'acknowledge once and return only after all holders settle',
    actual: { acknowledged, targets, settled },
    expected: { acknowledged: true, targets: 1, settled: 4 },
  });
});

test('a failed entrant releases peers and retains ownership until every holder settles', async () => {
  const first = Promise.withResolvers<void>();
  const slowCleanup = Promise.withResolvers<void>();
  const slowReleased = Promise.withResolvers<void>();
  const fault = new Error('controlled entrant failure');
  const timer = clock();
  let calls = 0,
    firstSettled = false;
  const scopes: string[] = [];
  const pressure = createMessagingPressure(
    async (scope: string, work) => {
      const call = ++calls;
      scopes.push(scope);
      if (call === 1) return first.promise;
      await work();
      if (call === 2) {
        slowReleased.resolve();
        await slowCleanup.promise;
      }
    },
    () => {},
    timer.schedule,
  );
  const one = pressure
    .prepare('first')
    .catch((error: unknown) => error)
    .finally(() => {
      firstSettled = true;
    });
  first.reject(fault);
  await slowReleased.promise;
  const two = pressure.prepare('second');
  await turn();
  let error: unknown;
  try {
    assert({
      given: 'an entrant rejected while a released peer has not settled',
      should:
        'release promptly but keep the first owner and withhold the second',
      actual: { calls, firstSettled },
      expected: { calls: 4, firstSettled: false },
    });
  } finally {
    slowCleanup.resolve();
    error = await one;
    await two;
    await pressure.allow();
  }
  assert({
    given: 'all first-owner holders settled before an explicit next prepare',
    should:
      'preserve the fault and use the new selectors in every new authority call',
    actual: {
      errors: error instanceof AggregateError ? error.errors : [],
      scopes,
    },
    expected: {
      errors: [fault],
      scopes: [...Array(4).fill('first'), ...Array(4).fill('second')],
    },
  });
});

test('target identity and later cleanup failures remain distinct without target retries', async () => {
  const targetFault = new Error('controlled target failure');
  const cleanupFault = new Error('controlled cleanup failure');
  const timer = clock();
  let calls = 0,
    targets = 0;
  const diagnostics: unknown[] = [];
  const pressure = createMessagingPressure(
    async (_scope: undefined, work) => {
      const call = ++calls;
      await work();
      if (call === 1) throw cleanupFault;
    },
    (sample) => diagnostics.push(sample),
    timer.schedule,
  );
  await pressure.prepare(undefined);
  const target = await pressure
    .target(async () => {
      targets += 1;
      throw targetFault;
    })
    .catch((error: unknown) => error);
  const cleanup = await pressure.allow().catch((error: unknown) => error);
  assert({
    given: 'one real target failure followed by one holder cleanup failure',
    should:
      'retain target identity, both final faults and separate stage outcomes without retry',
    actual: {
      targetIdentity: target === targetFault,
      errors: cleanup instanceof AggregateError ? cleanup.errors : [],
      targets,
      calls,
      diagnostics,
    },
    expected: {
      targetIdentity: true,
      errors: [targetFault, cleanupFault],
      targets: 1,
      calls: 4,
      diagnostics: [
        { stage: 'setup', entered: 4, result: 'ready', faults: 0 },
        { stage: 'target', entered: 4, result: 'failed', faults: 1 },
        { stage: 'release', entered: 4, result: 'failed', faults: 1 },
      ],
    },
  });
});

test('the finite epoch releases on expiry and rejects a late authority callback', async () => {
  const fourth = Promise.withResolvers<void>();
  const timer = clock();
  let calls = 0,
    targets = 0,
    released = 0;
  const pressure = createMessagingPressure(
    async (_scope: undefined, work) => {
      calls += 1;
      if (calls === 4) await fourth.promise;
      await work();
      released += 1;
    },
    () => {},
    timer.schedule,
  );
  const prepared = pressure.prepare(undefined).catch((error: unknown) => error);
  await turn();
  timer.fire();
  await turn();
  fourth.resolve();
  const error = await prepared;
  await pressure
    .target(async () => {
      targets += 1;
    })
    .catch(() => undefined);
  await pressure.allow();
  assert({
    given: 'the declared epoch expires before the fourth real callback arrives',
    should:
      'settle the three released holders, reject the late callback and never run the target',
    actual: {
      calls,
      released,
      targets,
      faults: error instanceof AggregateError ? error.errors.length : 0,
    },
    expected: { calls: 4, released: 3, targets: 0, faults: 2 },
  });
});

test('expiry releases acknowledged holders and requires a failed explicit acknowledgment', async () => {
  const results: unknown[] = [];
  for (const acknowledge of ['allow', 'prepare'] as const) {
    const timer = clock();
    let calls = 0,
      released = 0,
      targets = 0;
    const pressure = createMessagingPressure(
      async (_scope: undefined, work) => {
        calls += 1;
        await work();
        released += 1;
      },
      () => {},
      timer.schedule,
    );
    await pressure.prepare(undefined);
    timer.fire();
    await turn();
    await pressure
      .target(async () => {
        targets += 1;
      })
      .catch(() => undefined);
    const before = { calls, released, targets };
    const fault = await (
      acknowledge === 'allow' ? pressure.allow() : pressure.prepare(undefined)
    ).catch((error: unknown) => error);
    results.push({
      before,
      afterCalls: calls,
      reportedFaults: fault instanceof AggregateError ? fault.errors.length : 0,
    });
    // The explicit failed ACK consumed the retired fault; no automatic rearm occurred.
    await pressure.allow();
  }
  assert({
    given:
      'an acknowledged epoch expires and all its holders settle before allow or next prepare',
    should:
      'retain the fault until that explicit ACK fails without admitting another epoch',
    actual: results,
    expected: Array.from({ length: 2 }, () => ({
      before: { calls: 4, released: 4, targets: 0 },
      afterCalls: 4,
      reportedFaults: 1,
    })),
  });
});
