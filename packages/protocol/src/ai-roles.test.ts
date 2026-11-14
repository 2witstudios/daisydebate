import { assert, setupRitewayBun, test } from 'riteway/bun';
import { aiRoleFits, aiRoleOfSeat } from './ai-roles';

setupRitewayBun();

test('each kind of seat names the AI that may fill it (ISSUE-750, TAB-6.18)', () => {
  assert({
    given: 'a kind of Room seat',
    should:
      'give a judge seat to the AI judge, a side or speaker seat to a bot debater, and a moderator seat to no AI',
    actual: [
      aiRoleOfSeat('judge'),
      aiRoleOfSeat('side'),
      aiRoleOfSeat('speaker'),
      aiRoleOfSeat('moderator'),
    ],
    expected: ['judge', 'debater', 'debater', null],
  });
  assert({
    given: 'a bot debater, the AI judge and an actor of no AI role',
    should: 'fit each only the seats its role fills',
    actual: [
      aiRoleFits('debater', { kind: 'speaker', slot: 3 }),
      aiRoleFits('debater', { kind: 'side', side: 'negative', slot: 0 }),
      aiRoleFits('debater', { kind: 'judge', slot: 0 }),
      aiRoleFits('debater', { kind: 'moderator', slot: 0 }),
      aiRoleFits('judge', { kind: 'judge', slot: 0 }),
      aiRoleFits('judge', { kind: 'speaker', slot: 0 }),
      aiRoleFits(null, { kind: 'speaker', slot: 0 }),
    ],
    expected: [true, true, false, false, true, false, false],
  });
});
