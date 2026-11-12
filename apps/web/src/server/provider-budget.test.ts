import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import {
  createProviderBudget,
  isProviderBudgetRefusal,
} from './provider-budget';
setupRitewayBun();
test('provider slots remain occupied until actual calls settle, even when cancelled', async () => {
  const budget = createProviderBudget(1);
  let release!: () => void;
  const finished = new Promise<void>((resolve) => {
    release = resolve;
  });
  const controller = new AbortController();
  const first = budget(controller.signal, () => finished);
  controller.abort();
  await assertRejects({
    given: 'an aborted provider operation that has not settled',
    should: 'refuse another dispatch without releasing the resource early',
    actual: () => budget(new AbortController().signal, async () => true),
    code: 'CONFLICT',
  });
  release();
  await first;
  assert({
    given: 'the actual previous call settled',
    should: 'admit the next operation and return its value',
    actual: await budget(new AbortController().signal, async () => 42),
    expected: 42,
  });
  await assertRejects({
    given: 'a cancelled caller before dispatch',
    should: 'never invoke its provider operation',
    actual: () =>
      budget(controller.signal, async () => {
        throw Error('must not run');
      }),
    code: 'CONFLICT',
  });
});
test('provider rejection releases capacity without masking the original failure', async () => {
  const budget = createProviderBudget(1);
  let failure: unknown;
  const original = Error('failed operation');
  try {
    await budget(new AbortController().signal, async () => {
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
      await budget(new AbortController().signal, async () => true),
    ],
    expected: [true, true],
  });
});
test('separate budgets never share a counter', async () => {
  const competitive = createProviderBudget(1);
  const analysis = createProviderBudget(1);
  const heldAnalysis = analysis.reserve();
  const competitiveSlot = competitive.reserve();
  assert({
    given: 'a full round analysis budget',
    should: 'still admit competitive work, and the reverse',
    actual: {
      competitive: typeof competitiveSlot,
      analysisFull: analysis.reserve(),
      competitiveFull: competitive.reserve(),
    },
    expected: {
      competitive: 'function',
      analysisFull: null,
      competitiveFull: null,
    },
  });
  heldAnalysis?.();
  assert({
    given: 'the analysis slot released while competitive work is held',
    should: 'admit analysis again',
    actual: typeof analysis.reserve(),
    expected: 'function',
  });
  competitiveSlot?.();
});
test('a budget needs a positive integer limit', async () => {
  await assertRejects({
    given: 'a zero limit',
    should: 'refuse with VALIDATION',
    actual: async () => createProviderBudget(0),
    code: 'VALIDATION',
  });
});

test('a full budget refuses as backpressure; a cancelled call does not', async () => {
  const budget = createProviderBudget(1);
  const held = Promise.withResolvers<void>();
  const first = budget(new AbortController().signal, () => held.promise);
  const kind = (signal: AbortSignal) =>
    budget(signal, async () => undefined).then(
      () => 'ran',
      (error: unknown) =>
        isProviderBudgetRefusal(error) ? 'budget full' : 'other refusal',
    );
  const full = await kind(new AbortController().signal);
  held.resolve();
  await first;
  assert({
    given:
      'a call while the budget is full, then a call already cancelled with room to spare',
    should: 'name only the first as the budget being full',
    actual: [full, await kind(AbortSignal.abort())],
    expected: ['budget full', 'other refusal'],
  });
});
