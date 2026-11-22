import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoundRoomAuthority } from '@daisy/db';
import type { AccountAuthorizationFact } from '@daisy/auth/authorization';
import { createAppError } from '@daisy/errors';
import { rejectionOf } from '@daisy/errors/testing';
import type { LaunchedRound } from '@daisy/protocol/round-view';
import { account, caller } from '../room-runtime/operations.test-support';
import { launched, round } from './round.test-support';
import { roundViewReader, canReadRound } from './reads';
import { noLinkedAdults } from '../spectating/linked-adults';

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
    actual: (
      await roundViewReader(store(launched), noLinkedAdults)(caller, round.id)
    ).id,
    expected: round.id,
  });
  assert({
    given: 'a resource the caller is unbound from',
    should: 'leave access to the canonical evaluator and refuse',
    actual: (
      await rejectionOf(() =>
        roundViewReader(
          store({ ...launched, hostActorId: null, participants: [] }),
          noLinkedAdults,
        )(caller, round.id),
      )
    )?.code,
    expected: 'NOT_FOUND',
  });
});

test("roundViewReader() and a Youth Round's linked adult (ADR 0155)", async () => {
  const unseated = { ...launched, hostActorId: null, participants: [] };
  const asked: string[] = [];
  const linked = (actorIds: readonly string[]) =>
    Object.assign(
      async (roundId: string) => {
        asked.push(roundId);
        return { linkedAdultActorIds: actorIds };
      },
      { peek: () => undefined },
    );
  const watched = await roundViewReader(
    store(unseated),
    linked([caller.actorId]),
  )(caller, round.id);
  assert({
    given: 'a caller the Round seats nowhere, linked to one of its debaters',
    should:
      'read the Round once more with its linked adults, as an undelayed observer',
    actual: [watched.id, watched.viewerWatchesAs, asked],
    expected: [round.id, 'linked_adult', [round.id]],
  });
  assert({
    given: 'a caller linked to no debater of the Round',
    should: 'refuse as for a missing Round',
    actual: (
      await rejectionOf(() =>
        roundViewReader(store(unseated), linked(['someone-else']))(
          caller,
          round.id,
        ),
      )
    )?.code,
    expected: 'NOT_FOUND',
  });
  const hostAsked = asked.length;
  await roundViewReader(store(launched), linked([caller.actorId]))(
    caller,
    round.id,
  );
  assert({
    given: 'the host, whom the Round admits on the first read',
    should: "never read anyone's links",
    actual: asked.length,
    expected: hostAsked,
  });
});

test('a watcher the cache already names reads the Round once (ADR 0155)', async () => {
  const unseated = { ...launched, hostActorId: null, participants: [] };
  let reads = 0;
  const counted = store(unseated) as {
    readLaunchedRound: (...args: unknown[]) => Promise<unknown>;
  };
  const read = counted.readLaunchedRound;
  counted.readLaunchedRound = (...args) => {
    reads += 1;
    return read(...args);
  };
  const known = Object.assign(async () => null, {
    peek: () => ({ linkedAdultActorIds: [caller.actorId] }),
  });
  const watched = await roundViewReader(counted as never, known)(
    caller,
    round.id,
  );
  assert({
    given: 'a linked adult whose Round the people cache already holds',
    should:
      'read the Round once, with its linked adults, and never be refused first',
    actual: [watched.viewerWatchesAs, reads],
    expected: ['linked_adult', 1],
  });
});

test('a caller who holds the capability without the links stays a host (ADR 0155)', async () => {
  const both = Object.assign(async () => null, {
    peek: () => ({ linkedAdultActorIds: [caller.actorId] }),
  });
  const watched = await roundViewReader(
    store({ ...launched, participants: [] }),
    both,
  )(caller, round.id);
  assert({
    given:
      'the Round’s seatless host (as an event official is) whom the links also name',
    should: 'read as a host, never as a linked adult',
    actual: watched.viewerWatchesAs,
    expected: 'host',
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
