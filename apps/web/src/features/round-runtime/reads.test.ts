import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { AccountAuthorizationFact } from '@daisy/auth/authorization';
import { createAppError } from '@daisy/errors';
import { rejectionOf } from '@daisy/errors/testing';
import type { LaunchedRound } from '@daisy/protocol';
import { account, caller } from '../room-runtime/operations.test-support';
import { launched, round } from './round.test-support';
import { roundViewReader } from './reads';

setupRitewayBun();

const store = (seen: LaunchedRound) =>
  ({
    readLaunchedRound: async (
      _id: string,
      _caller: typeof caller,
      authorize: (
        candidate: LaunchedRound,
        fact: AccountAuthorizationFact,
      ) => boolean,
    ) => {
      if (!authorize(seen, account)) throw createAppError('NOT_FOUND');
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
