import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireBotClaimSeat as requirePublishingSeat } from './admission';
setupRitewayBun();
test('bots publish only for a debating seat of an active Round', async () => {
  assert({
    given: 'a debating seat in an active Round',
    should: 'admit the claim',
    actual: requirePublishingSeat(
      { status: 'active' },
      { seat: { kind: 'side', side: 'negative', slot: 0 } },
    ),
    expected: undefined,
  });
  for (const [status, seat] of [
    ['opening', { kind: 'side', side: 'negative', slot: 0 }],
    ['completed', { kind: 'side', side: 'affirmative', slot: 0 }],
    ['active', { kind: 'judge', slot: 0 }],
  ] as const)
    await assertRejects({
      given: `a ${seat.kind} seat in a ${status} Round`,
      should: 'refuse publication authority',
      actual: () => requirePublishingSeat({ status }, { seat }),
      code: 'AUTHORIZATION',
    });
});
