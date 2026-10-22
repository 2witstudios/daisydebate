import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createProviderCapacity } from './provider-capacity';
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
