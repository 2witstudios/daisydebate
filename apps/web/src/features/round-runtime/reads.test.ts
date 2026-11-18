import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoundRoomAuthority } from '@daisy/db';
import type { AccountAuthorizationFact } from '@daisy/auth/authorization';
import { createAppError } from '@daisy/errors';
import { rejectionOf } from '@daisy/errors/testing';
import type { LaunchedRound } from '@daisy/protocol';
import { account, caller } from '../room-runtime/operations.test-support';
import { launched, round } from './round.test-support';
import { roundViewReader, canReadRound } from './reads';

setupRitewayBun();

const store = (seen: LaunchedRound) =>
  ({
    readLaunchedRound: async (
      _id: string,
      _caller: typeof caller,
      authorize: (
        candidate: LaunchedRound,
        fact: AccountAuthorizationFact,
        authority: RoundRoomAuthority,
      ) => boolean,
    ) => {
      if (
        !authorize(seen, account, {
          kind: 'ordinary',
          checkedAt: '2026-11-15T00:00:00.000Z',
        })
      )
        throw createAppError('NOT_FOUND');
      return round;
    },
    broadcasts: { conversationHeld: async () => false },
  }) as never;

test('roundViewReader()', async () => {
  assert({
    given: 'the host of a private Round',
    should: 'return the projection',
    actual: (await roundViewReader(store(launched))(caller, round.id)).id,
    expected: round.id,
  });
  assert({
    given: 'a resource the caller is unbound from',
    should: 'leave access to the canonical evaluator and refuse',
    actual: (
      await rejectionOf(() =>
        roundViewReader(
          store({ ...launched, hostActorId: null, participants: [] }),
        )(caller, round.id),
      )
    )?.code,
    expected: 'NOT_FOUND',
  });
});

test('an explicitly unavailable event source never uses an ordinary host shortcut', () => {
  assert({
    given:
      'the same ordinary host-shaped Round with an explicit ordinary, missing-event or unavailable Room source',
    should:
      'admit only the actual ordinary source and fail closed for missing event authority',
    actual: [
      canReadRound(caller, launched, account, {
        kind: 'ordinary',
        checkedAt: '2026-11-15T00:00:00.000Z',
      }),
      canReadRound(caller, launched, account, {
        kind: 'event',
        direction: null,
        checkedAt: '2026-11-15T00:00:00.000Z',
      }),
      canReadRound(caller, launched, account, {
        kind: 'unavailable',
        checkedAt: '2026-11-15T00:00:00.000Z',
      }),
    ],
    expected: [true, false, false],
  });
});
