import { assert, setupRitewayBun, test } from 'riteway/bun';
import { answered, harness, job } from './speaker.test-support';
setupRitewayBun();

test('a paid voice still settling is awaited once when it becomes the current phrase', async () => {
  const gate = Promise.withResolvers<void>();
  let secondSettlements = 0;
  const run = harness('speech', {
    generate: async () => answered({ phrases: ['One.', 'Two.'] }),
    synthesize: async (phraseId, text) => ({
      value: job(phraseId, text, 24000 * 5),
      settle: async () => {
        if (text === 'Two.') {
          secondSettlements += 1;
          await gate.promise;
        }
      },
    }),
  });
  run.speaker.wake();
  await run.settle();
  await run.release();
  const beforeReceipt = {
    attempts: secondSettlements,
    published: run.log.filter((entry) => entry.startsWith('publish:')),
  };
  gate.resolve();
  await run.settle();
  await run.release();
  await run.speaker.stop();
  assert({
    given: 'the next paid voice whose usage settlement has not returned',
    should:
      'await its existing settlement before publishing, without a concurrent retry',
    actual: {
      beforeReceipt,
      attempts: secondSettlements,
      published: run.log.filter((entry) => entry.startsWith('publish:')),
    },
    expected: {
      beforeReceipt: { attempts: 1, published: ['publish:One.'] },
      attempts: 1,
      published: ['publish:One.', 'publish:Two.'],
    },
  });
});
