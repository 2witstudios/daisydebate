import { describe, expect, test } from 'bun:test';
import {
  friendRequestState,
  protectionLevels,
  protectionLimits,
  type ProtectionLevel,
} from './protection-level';

describe('protectionLimits', () => {
  test.each([
    [{ level: 'independent' }, 'none', null, true],
    [{ level: 'guided' }, 'inbound-adult', null, true],
    [{ level: 'supervised' }, 'all', 'friends', false],
    [
      {
        level: 'custom',
        friendApproval: 'inbound-adult',
        friendsOnlyMessages: true,
        rankedAllowed: true,
      },
      'inbound-adult',
      'friends',
      true,
    ],
    [
      {
        level: 'custom',
        friendApproval: 'none',
        friendsOnlyMessages: false,
        rankedAllowed: false,
      },
      'none',
      null,
      false,
    ],
  ] as const)(
    'expands %j to their effective limits',
    (choice, friendApproval, messageRequests, rankedAllowed) => {
      expect(protectionLimits(choice satisfies ProtectionLevel)).toEqual({
        friendApproval,
        messageRequests,
        rankedAllowed,
      });
    },
  );
});

describe('friendRequestState', () => {
  test.each([...protectionLevels])(
    '%s considers direction and the other member’s age',
    (level) => {
      const limits = protectionLimits(
        level === 'custom'
          ? {
              level,
              friendApproval: 'inbound-adult',
              friendsOnlyMessages: false,
              rankedAllowed: true,
            }
          : { level },
      );
      const asks = [
        ['incoming', 'adult'],
        ['incoming', '13-15'],
        ['incoming', '16-17'],
        ['outgoing', 'adult'],
        ['outgoing', '13-15'],
        ['outgoing', '16-17'],
        ['incoming', null],
      ] as const;
      const holds = asks.map(([direction, otherAge]) =>
        friendRequestState([
          { actorId: 'child', limits, direction, otherAge, cleared: false },
        ]),
      );
      const pending = { state: 'pending' as const, holds: [] };
      const waiting = {
        state: 'waiting-for-guardian' as const,
        holds: ['child'],
      };
      expect(holds).toEqual(
        level === 'independent'
          ? asks.map(() => pending)
          : level === 'supervised'
            ? asks.map(() => waiting)
            : [waiting, ...asks.slice(1, -1).map(() => pending), waiting],
      );
    },
  );
});

test('both supervised children have an independent hold on the same request', () => {
  const limits = protectionLimits({ level: 'supervised' });
  const sender = {
    actorId: 'sender',
    limits,
    direction: 'outgoing',
    otherAge: '16-17',
    cleared: false,
  } as const;
  const recipient = {
    actorId: 'recipient',
    limits,
    direction: 'incoming',
    otherAge: '13-15',
    cleared: false,
  } as const;
  expect(friendRequestState([sender, recipient])).toEqual({
    state: 'waiting-for-guardian',
    holds: ['sender', 'recipient'],
  });
  expect(friendRequestState([{ ...sender, cleared: true }, recipient])).toEqual(
    {
      state: 'waiting-for-guardian',
      holds: ['recipient'],
    },
  );
  expect(
    friendRequestState([
      { ...sender, cleared: true },
      { ...recipient, cleared: true },
    ]),
  ).toEqual({
    state: 'pending',
    holds: [],
  });
});
