import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { buildRoomTopic } from '@daisy/protocol';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { withBoundedRound } from './bounded-transaction.test-support';
import { createAuthorizationSubject } from './authorization.test-support';
import { validConfig, validRules } from './round-fixtures';
import { roomCommandTransaction } from '../src/room-command-transaction';
import { roomCommandOperations } from '../src/room-command-operations';
import { createRoundBotAdmission } from '../src/round-bot-admission';
setupRitewayBun();
requireTestServices(process.env);

test('bot Room freeze reserves once atomically and replay cannot charge twice', async () => {
  await withBoundedRound(async (fixture, run) => {
    const caller = await createAuthorizationSubject(fixture);
    const formatId = await fixture.format();
    const roomId = createId(),
      roundId = createId(),
      bot = createId();
    await fixture.insert('actors', { id: bot, kind: 'bot' });
    await fixture.insert(
      'bot_profiles',
      {
        actor_id: bot,
        name: 'Bot judge',
        persona: 'Fixture',
        voice: 'aura-2-thalia-en',
      },
      'actor_id',
    );
    await fixture.insert('rooms', {
      id: roomId,
      host_actor_id: caller.actorId,
      title: 'Admission proof',
      topic: 'Motion',
      visibility: 'private',
      format_id: formatId,
      format_version: 1,
      competition_type: 'casual',
      config: validConfig,
      execution_plan: { preRoundPrep: { enabled: false } },
      rules_snapshot: validRules,
      status: 'ready',
    });
    for (const [actorId, role] of [
      [caller.actorId, 'affirmative'],
      [bot, 'judge'],
    ] as const)
      await fixture.insert('room_participants', {
        id: createId(),
        room_id: roomId,
        actor_id: actorId,
        role,
        slot: 0,
      });
    const common = {
      database: drizzle({ client: fixture.sql }),
      commandTransaction: roomCommandTransaction(fixture.sql, 4),
    };
    const input: Parameters<
      ReturnType<typeof roomCommandOperations>['executeRoomCommand']
    >[0] = {
      caller,
      actorId: caller.actorId,
      roomId,
      roundId,
      commandId: createId(),
      payloadDigest: 'a'.repeat(64),
      type: 'start-round',
      targetActorId: null,
      authorizeRead: (state, account) =>
        account?.member === true && state.hostActorId === caller.actorId,
      // The DB adapter receives an accepted pure mutation; no vendor or database is mocked.
      prepare: async () => (state) => ({
        ok: true,
        mutation: {
          state: {
            ...state,
            status: 'started',
            version: state.version + 1,
            changeVersion: state.changeVersion + 1,
          },
          freeze: true,
          consent: null,
          publishDefinition: false,
          members: [state.hostActorId],
        },
      }),
    };
    await assertRejects({
      given: 'a bot judge and no explicit admission capacity',
      should: 'refuse the whole freeze without leaving a Round',
      actual: () => roomCommandOperations(common).executeRoomCommand(input),
      code: 'INFRASTRUCTURE',
    });
    assert({
      given: 'a refused bot freeze',
      should: 'roll back durable Round creation',
      actual: await fixture.count('rounds', 'id', roundId),
      expected: 0,
    });
    const operations = roomCommandOperations({
      ...common,
      botAdmission: createRoundBotAdmission({
        run,
        nextId: createId,
        busyCap: 4,
      }),
    });
    try {
      fixture.track('rounds', roundId);
      const first = await operations.executeRoomCommand(input);
      const replay = await operations.executeRoomCommand(input);
      assert({
        given: 'an accepted bot judge freeze and exact replay',
        should: 'retain one Round, one reservation and one result identity',
        actual: [
          first.roundRef,
          replay.roundRef,
          replay.replayed,
          await fixture.count('usage_reservations', 'round_id', roundId),
        ],
        expected: [
          { id: roundId, status: 'scheduled' },
          { id: roundId, status: 'scheduled' },
          true,
          1,
        ],
      });
    } finally {
      await fixture.sql`delete from outbox where topic=${buildRoomTopic(roomId)}`;
    }
  });
});
