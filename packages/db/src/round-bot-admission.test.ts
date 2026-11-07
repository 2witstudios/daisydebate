import { assertRejects } from '@daisy/errors/testing';
import { setupRitewayBun, test } from 'riteway/bun';
import { createRoundBotAdmission } from './round-bot-admission';
setupRitewayBun();
test('bot capacity must be explicitly positive and finite', async () => {
  for (const busyCap of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
    await assertRejects({
      given: `capacity ${busyCap}`,
      should: 'refuse before any admission operation can run',
      code: 'VALIDATION',
      actual: () =>
        createRoundBotAdmission({
          busyCap,
          nextId: () => {
            throw Error('unexpected ID');
          },
          run: async () => {
            throw Error('unexpected transaction');
          },
          allowance: () => {
            throw Error('unexpected policy');
          },
          accountEligible: () => false,
        }),
    });
});
