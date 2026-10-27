import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { foundationDefinition } from './reference-formats';
import {
  accountFact,
  caller,
  room,
} from './room-command-operations.test-support';
import { createTestDatabase, roomRow } from './index.test-support';

setupRitewayBun();

const now = [{ now: new Date('2026-10-09T00:10:00.000Z') }];
const otherRoomId = 'c1a3e5g7j9k2m4n6p8r1t3v5';

test('a create whose host another Room holds is refused as active-room (ADR 0070)', async () => {
  const account = accountFact();
  const { database, queries } = createTestDatabase([
    [],
    [account],
    [account],
    [],
    [],
    [],
    now,
    [],
    [],
    [],
    [[otherRoomId]],
  ]);
  await assertRejects({
    given: 'a host whose membership row names another Room',
    should: 'refuse the create with a conflict',
    actual: () =>
      database.createRoomCommand({
        room,
        members: [room.hostActorId],
        commandId: 'c4a2b6d8f1h3j5k7m9n2p4r6',
        payloadDigest: 'a'.repeat(64),
        definition: foundationDefinition,
        caller,
        authorize: (fact) => fact?.member === true,
      }),
    code: 'CONFLICT',
  });
  assert({
    given: 'the refused create',
    should:
      'claim the membership with a conflict-tolerant insert, then recheck it',
    actual: queries.some(({ query }) =>
      query.includes(
        'insert into "room_active_memberships" ("actor_id", "room_id", "created_at") values ($1, $2, default) on conflict ("actor_id") do nothing',
      ),
    ),
    expected: true,
  });
});

test('the active room read maps the membership row, and no row reads as none', async () => {
  const roundId = 'c2b4d6f8h1j3k5m7n9p2r4t6';
  const { database } = createTestDatabase([
    [accountFact()],
    [
      [
        room.id,
        'Proof room',
        caller.actorId,
        'started',
        roundId,
        'active',
        null,
        null,
      ],
    ],
    [accountFact()],
    [],
  ]);
  const authorize = (fact: { member: boolean } | null) => fact?.member === true;
  assert({
    given: 'a host held by a live Room, then an actor no Room holds',
    should: 'return the portable facts, then null',
    actual: [
      await database.readActiveRoomFacts(caller, authorize),
      await database.readActiveRoomFacts(caller, authorize),
    ],
    expected: [
      {
        room: { id: room.id, title: 'Proof room', hostActorId: caller.actorId },
        status: 'started',
        roundRef: { id: roundId, status: 'active' },
        seatRole: null,
        debateEnded: false,
      },
      null,
    ],
  });
});

test('idle candidates refuse invalid policy and return the prefiltered ids', async () => {
  const { database, queries } = createTestDatabase([[[room.id]]]);
  await assertRejects({
    given: 'a zero idle timeout',
    should: 'refuse it as invalid',
    actual: () =>
      database.readMaintenanceCandidates({ idleTimeoutMs: 0, limit: 64 }),
    code: 'VALIDATION',
  });
  assert({
    given: 'a ten minute timeout',
    should: 'return the open Rooms idle by database time',
    actual: [
      await database.readMaintenanceCandidates({
        idleTimeoutMs: 600_000,
        limit: 64,
      }),
      queries.at(-1)?.query.includes('statement_timestamp()'),
    ],
    expected: [[room.id], true],
  });
});

test('a Room another writer holds, or the engine keeps open, is not expired', async () => {
  const { database, queries } = createTestDatabase([
    [],
    [roomRow()],
    now,
    [[foundationDefinition]],
    [],
    [],
    [],
    [],
  ]);
  const decided: string[] = [];
  const maintain = (_state: unknown, facts: { lastCommandAt: string }) => {
    decided.push(facts.lastCommandAt);
    return null;
  };
  assert({
    given: 'a Room locked by another writer, then one the engine keeps open',
    should: 'skip the locked Room and write nothing for either',
    actual: [
      await database.maintainRoom({ roomId: room.id, maintain }),
      await database.maintainRoom({ roomId: room.id, maintain }),
      decided,
      queries.some(({ query }) => query.startsWith('update "rooms"')),
      queries.some(({ query }) => query.includes('skip locked')),
    ],
    expected: [false, false, [new Date(0).toISOString()], false, true],
  });
});

test('an idle Room the engine expires is closed, released and announced', async () => {
  const { database, queries } = createTestDatabase([
    [roomRow()],
    now,
    [[foundationDefinition]],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    [[1n, '42']],
    [],
  ]);
  const expired = await database.maintainRoom({
    roomId: room.id,
    maintain: (state) => ({
      ok: true,
      mutation: {
        state: { ...state, status: 'abandoned', changeVersion: 2 },
        consent: null,
        freeze: false,
        publishDefinition: false,
        drawSecrets: null,
        members: [],
      },
    }),
  });
  assert({
    given: 'an open Room the engine finds idle',
    should:
      'abandon it, delete every membership it held and ring its doorbell once',
    actual: [
      expired,
      queries.some(({ query }) => query.startsWith('update "rooms"')),
      queries.some(({ query }) =>
        query.startsWith('delete from "room_active_memberships"'),
      ),
      queries.filter(({ query }) => query.includes('pg_notify')).length,
    ],
    expected: [true, true, true, 1],
  });
});
