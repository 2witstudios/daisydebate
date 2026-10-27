import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createProviderCapacity, providerAdmission } from './provider-capacity';
setupRitewayBun();
test('provider slots remain occupied until actual calls settle, even when cancelled', async () => {
  const capacity = createProviderCapacity(1);
  let release!: () => void;
  const finished = new Promise<void>((resolve) => {
    release = resolve;
  });
  const controller = new AbortController();
  const first = capacity(controller.signal, () => finished);
  controller.abort();
  await assertRejects({
    given: 'an aborted provider operation that has not settled',
    should: 'refuse another dispatch without releasing the resource early',
    actual: () => capacity(new AbortController().signal, async () => true),
    code: 'CONFLICT',
  });
  release();
  await first;
  assert({
    given: 'the actual previous call settled',
    should: 'admit the next operation and return its value',
    actual: await capacity(new AbortController().signal, async () => 42),
    expected: 42,
  });
  await assertRejects({
    given: 'a cancelled caller before dispatch',
    should: 'never invoke its provider operation',
    actual: () =>
      capacity(controller.signal, async () => {
        throw Error('must not run');
      }),
    code: 'CONFLICT',
  });
});
test('provider rejection releases capacity without masking the original failure', async () => {
  const capacity = createProviderCapacity(1);
  let failure: unknown;
  const original = Error('failed operation');
  try {
    await capacity(new AbortController().signal, async () => {
      throw original;
    });
  } catch (error) {
    failure = error;
  }
  assert({
    given: 'a provider operation rejection',
    should: 'preserve its error and release the occupied slot',
    actual: [
      failure === original,
      await capacity(new AbortController().signal, async () => true),
    ],
    expected: [true, true],
  });
});

test('coaching cannot consume the final competitive provider slot', async () => {
  const capacity = createProviderCapacity(2);
  const held = Promise.withResolvers<void>();
  const coaching = capacity(
    new AbortController().signal,
    () => held.promise,
    'coaching',
  );
  try {
    await assertRejects({
      given: 'coaching already owns its bounded share',
      should: 'refuse further coaching before it can consume judging capacity',
      actual: () =>
        capacity(new AbortController().signal, async () => true, 'coaching'),
      code: 'CONFLICT',
    });
    const release = capacity.reserve('judging');
    assert({
      given: 'coaching is still running',
      should: 'reserve the remaining slot for a judge immediately',
      actual: typeof release,
      expected: 'function',
    });
    release?.();
  } finally {
    held.resolve();
    await coaching;
  }
});

test('single-slot deployments preserve judging and disable background coaching', async () => {
  const capacity = createProviderCapacity(1);
  await assertRejects({
    given: 'one configured provider slot',
    should: 'keep it available to competitive work',
    actual: () =>
      capacity(new AbortController().signal, async () => true, 'coaching'),
    code: 'CONFLICT',
  });
  assert({
    given: 'coaching was refused',
    should: 'still dispatch judging within the configured budget',
    actual: await capacity(
      new AbortController().signal,
      async () => 42,
      'judging',
    ),
    expected: 42,
  });
});

test('provider admission is a pure bounded decision for every work class', () => {
  const decisions = [
    {
      limit: 4,
      active: { judging: 0, realtime: 0, coaching: 2 },
      workClass: 'coaching',
      expected: false,
    },
    {
      limit: 4,
      active: { judging: 1, realtime: 1, coaching: 1 },
      workClass: 'coaching',
      expected: false,
    },
    {
      limit: 4,
      active: { judging: 0, realtime: 1, coaching: 1 },
      workClass: 'coaching',
      expected: true,
    },
    {
      limit: 4,
      active: { judging: 0, realtime: 0, coaching: 2 },
      workClass: 'judging',
      expected: true,
    },
    {
      limit: 4,
      active: { judging: 1, realtime: 1, coaching: 2 },
      workClass: 'judging',
      expected: false,
    },
    {
      limit: 4,
      active: { judging: 1, realtime: 1, coaching: 2 },
      workClass: 'realtime',
      expected: false,
    },
  ] as const;
  assert({
    given: 'coaching share, reserved slot and global budget boundaries',
    should: 'admit only bounded work while prioritizing competitive capacity',
    actual: decisions.map(providerAdmission),
    expected: decisions.map(({ expected }) => expected),
  });
});
