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
import { testBotAdmission } from './bot-admission.test-support';
import { createBotSeat } from './bot-seat.test-support';
setupRitewayBun();
requireTestServices(process.env);

/**
 * A ready Room hosted by an approved member with one bot seat, and its
 * start-round input. `spendsAiRound` defaults to the casual rule; ranked play
 * seats a bot debater without spending an allowance.
 */
const withBotRoom = (
  botRole: 'negative' | 'judge',
  work: (value: {
    fixture: Parameters<Parameters<typeof withBoundedRound>[0]>[0];
    run: Parameters<Parameters<typeof withBoundedRound>[0]>[1];
    roomId: string;
    roundId: string;
    common: Omit<Parameters<typeof roomCommandOperations>[0], 'botAdmission'>;
    input: Parameters<
      ReturnType<typeof roomCommandOperations>['executeRoomCommand']
    >[0];
  }) => Promise<void>,
  spendsAiRound = botRole !== 'judge',
) =>
  withBoundedRound(async (fixture, run) => {
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
        name: 'Fixture bot',
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
      [bot, botRole],
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
      seatsBotDebater: () => botRole !== 'judge',
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
          spendsAiRound,
          seatsBotDebater: botRole !== 'judge',
          consent: null,
          publishDefinition: false,
          members: [state.hostActorId],
        },
      }),
    };
    try {
      fixture.track('rounds', roundId);
      await work({ fixture, run, roomId, roundId, common, input });
    } finally {
      await fixture.sql`delete from outbox where topic=${buildRoomTopic(roomId)}`;
    }
  });

test('bot-debater Room freeze reserves once atomically and replay cannot charge twice', async () => {
  await withBotRoom(
    'negative',
    async ({ fixture, run, roundId, common, input }) => {
      await assertRejects({
        given: 'a bot debater and no explicit admission capacity',
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
        botAdmission: testBotAdmission(run),
      });
      const first = await operations.executeRoomCommand(input);
      const replay = await operations.executeRoomCommand(input);
      assert({
        given: 'an accepted bot-debater freeze and exact replay',
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
    },
  );
});

test('only a launch that seats a bot debater takes the bot-admission lock', async () => {
  const locksTaken = async (botRole: 'negative' | 'judge') => {
    let locks = 0;
    await withBotRoom(botRole, async ({ run, common, input }) => {
      const admission = testBotAdmission(run);
      await roomCommandOperations({
        ...common,
        botAdmission: {
          ...admission,
          lock: (tx) => {
            locks += 1;
            return admission.lock(tx);
          },
        },
      }).executeRoomCommand(input);
    });
    return locks;
  };
  assert({
    given: 'a launch with a bot debater and one whose only bot judges',
    should:
      'serialize only the bot-debater launch on the fleet bot-admission lock',
    actual: [await locksTaken('negative'), await locksTaken('judge')],
    expected: [1, 0],
  });
});

test('an AI judge alone is free: the freeze needs no bot admission and reserves nothing', async () => {
  await withBotRoom('judge', async ({ fixture, roundId, common, input }) => {
    const accepted =
      await roomCommandOperations(common).executeRoomCommand(input);
    assert({
      given: 'human debaters with only an AI judge and no admission resource',
      should: 'freeze the Round without reserving the host allowance',
      actual: [
        accepted.roundRef,
        await fixture.count('usage_reservations', 'round_id', roundId),
      ],
      expected: [{ id: roundId, status: 'scheduled' }, 0],
    });
  });
});

test('a bot debater that spends no allowance still takes a capacity slot (ISSUE-773)', async () => {
  await withBotRoom(
    'negative',
    async ({ fixture, run, roundId, common, input }) => {
      const live = await fixture.round();
      await createBotSeat(fixture, live, 'negative');
      await assertRejects({
        given:
          'a ranked-style freeze (no allowance) and another live bot-debater Round at a cap of 1',
        should: 'refuse the whole freeze for capacity',
        actual: () =>
          roomCommandOperations({
            ...common,
            botAdmission: testBotAdmission(run, 1),
          }).executeRoomCommand(input),
        code: 'CONFLICT',
      });
      const accepted = await roomCommandOperations({
        ...common,
        botAdmission: testBotAdmission(run, 2),
      }).executeRoomCommand(input);
      assert({
        given: 'the same freeze with a free slot',
        should: 'freeze the Round without reserving the host allowance',
        actual: [
          accepted.roundRef,
          await fixture.count('usage_reservations', 'round_id', roundId),
        ],
        expected: [{ id: roundId, status: 'scheduled' }, 0],
      });
    },
    false,
  );
});
