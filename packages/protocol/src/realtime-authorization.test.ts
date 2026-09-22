import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { debateRoles } from './primitives';
import { subscribeAuthorizationTable } from './realtime';

setupRitewayBun();

describe('subscribe authorization table', () => {
  test('equals the exact rule for every topic family, including the two private-debate rows', () => {
    assert({
      given: 'the whole authorization table',
      should:
        'match every row exactly, so swapping debate or debate:presence to any-member fails this test',
      actual: subscribeAuthorizationTable,
      expected: {
        debate: {
          kind: 'public-or-private-participant',
          privateRoles: debateRoles,
          admitsInvitedSpectators: true,
        },
        'debate:presence': {
          kind: 'public-or-private-participant',
          privateRoles: debateRoles,
          admitsInvitedSpectators: true,
        },
        'debate:chat': {
          kind: 'chat-participant-or-public-member',
          privateRoles: debateRoles,
        },
        'user:inbox': { kind: 'owner-only' },
        standings: { kind: 'any-member' },
      },
    });
  });

  test('encodes the private-debate role set as the ADR 0029 seat-role vocabulary', () => {
    const debateRule = subscribeAuthorizationTable.debate as {
      privateRoles: typeof debateRoles;
    };
    assert({
      given: "the debate family's private-participant roles",
      should:
        'be exactly the seated-role vocabulary: affirmative, negative, judge',
      actual: debateRule.privateRoles,
      expected: ['affirmative', 'negative', 'judge'],
    });
  });

  test('has no entry for a topic family outside the vocabulary, so it is refused by default', () => {
    assert({
      given: 'a topic family outside the vocabulary',
      should: 'have no entry',
      actual: Object.hasOwn(subscribeAuthorizationTable, 'debate:notes'),
      expected: false,
    });
  });
});
