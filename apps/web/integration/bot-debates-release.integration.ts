import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { roomViewSchema } from '@daisy/protocol/room-read';
import { isRoundRunning } from '@daisy/protocol/round';
import { judgeSeat, negativeSide, sideSeat } from '@daisy/protocol/seats';
import { createRoomHttpFixture } from './room-http.test-support';
import { withSql } from './fixtures';
import { deleteOrphanNotificationSignals } from './notification-signals.test-support';
import { roomComposition } from '../src/features/room-runtime/composition';
import {
  oneOnOneDefinition,
  oneOnOneSettings,
} from '@daisy/db/reference-formats';
import { botAdmissionForTests } from './bot-admission.test-support';
import {
  launchRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';

requireTestServices(process.env);
setupRitewayBun();

/**
 * Bot debates are a release (ADR 0921): for an ordinary member, every
 * request that would seat a bot debater is refused as coming soon, whatever
 * else the request carries, and the AI judge is not part of it.
 */
const { f, routes, member } = createRoomHttpFixture();

const fixtureBots = async () => {
  const debater = createId(),
    judge = createId();
  await withSql(async (sql) => {
    await sql`insert into actors(id,kind) values (${debater},'bot'), (${judge},'bot')`;
    await sql`insert into bot_profiles(actor_id,name,persona,voice) values (${debater},'Release fixture bot','Argue only from the motion','test')`;
    await sql`insert into ai_judge_profiles(actor_id,name) values (${judge},'Release fixture judge')`;
  });
  return { debater, judge };
};
const removeBots = (ids: readonly string[]) =>
  withSql(async (sql) => {
    await sql`delete from bot_profiles where actor_id in ${sql(ids)}`;
    await sql`delete from ai_judge_profiles where actor_id in ${sql(ids)}`;
    await sql`delete from actors where id in ${sql(ids)}`;
  });
const refusalOf = async (response: Response) => [
  response.status,
  ((await response.json()) as { refusal?: string }).refusal,
];

test('an ordinary member is refused every request that seats a bot debater', async () => {
  const cookie = await member();
  const bots = await fixtureBots();
  const rooms: string[] = [];
  try {
    const create = (body: object) =>
      routes(roomComposition).create(
        f.jsonPost(
          '/api/rooms',
          {
            commandId: createId(),
            title: 'Practice vs Release fixture bot',
            resolution: { kind: 'strike' },
            visibility: 'public',
            selection: {
              kind: 'catalog',
              formatId: 'freestyle',
              formatVersion: 1,
              presetVersion: 1,
              competitionType: 'casual',
            },
            ...body,
          },
          { cookie },
        ),
      );
    // What Train's Start practice posts, sent directly.
    const practice = await create({
      sides: 'open',
      practice: true,
      cast: [{ actorId: bots.debater, seat: sideSeat(negativeSide) }],
    });
    const practiceAnswer = await refusalOf(practice);
    const withJudge = await create({
      cast: [
        { actorId: bots.debater, seat: sideSeat(negativeSide) },
        { actorId: bots.judge, seat: judgeSeat() },
      ],
    });
    const withJudgeAnswer = await refusalOf(withJudge);
    const plain = await create({});
    const room = roomViewSchema.parse((await plain.json()).view);
    rooms.push(room.id);
    const seat = await routes(roomComposition).commands(
      f.jsonPost(
        `/api/rooms/${room.id}/commands`,
        {
          type: 'assign-seat',
          commandId: createId(),
          expectedVersion: room.version,
          actorId: bots.debater,
          seat: sideSeat(negativeSide),
        },
        { cookie },
      ),
      room.id,
    );
    const seatAnswer = await refusalOf(seat);
    const after = roomViewSchema.parse(
      await (
        await routes(roomComposition).read(
          new Request(`${f.origin}/api/rooms/${room.id}`, {
            headers: { cookie, origin: f.origin },
          }),
          room.id,
        )
      ).json(),
    );
    const judgeOnly = await routes(roomComposition).commands(
      f.jsonPost(
        `/api/rooms/${room.id}/commands`,
        {
          type: 'assign-seat',
          commandId: createId(),
          expectedVersion: after.version,
          actorId: bots.judge,
          seat: judgeSeat(),
        },
        { cookie },
      ),
      room.id,
    );
    const judgeOnlyAnswer = await refusalOf(judgeOnly);
    assert({
      given:
        'an ordinary member posting a practice, a create with a bot debater and an AI judge, and assign-seat of a bot debater',
      should:
        'refuse each with bot-debates-coming-soon and leave the Room as it was',
      actual: [
        practiceAnswer,
        withJudgeAnswer,
        seatAnswer,
        after.version,
        after.participants.some((p) => p.kind === 'bot'),
      ],
      expected: [
        [409, 'bot-debates-coming-soon'],
        [409, 'bot-debates-coming-soon'],
        [409, 'bot-debates-coming-soon'],
        room.version,
        false,
      ],
    });
    assert({
      given: 'the same member assigning the AI judge',
      should:
        'not refuse it as a bot debate: the AI judge is not behind the flag',
      actual: judgeOnlyAnswer[1] === 'bot-debates-coming-soon',
      expected: false,
    });
  } finally {
    await withSql(async (sql) => {
      for (const id of rooms) {
        await sql`delete from outbox where topic=${`room:${id}`}`;
        await sql`delete from rooms where id=${id}`;
      }
      await deleteOrphanNotificationSignals(sql);
    });
    await removeBots([bots.debater, bots.judge]);
  }
});

type RuntimeFixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];

/** A casual one-on-one with the bot seated at negative and the host Ready. */
const botRoom = async (f: RuntimeFixture) => {
  const bot = await f.bot();
  const room = (
    await f.create({
      selection: {
        kind: 'custom',
        definition: {
          ...oneOnOneDefinition,
          seats: { ...oneOnOneDefinition.seats, judges: 0 },
        },
        config: {
          ...oneOnOneSettings,
          speechTiming: { ...oneOnOneSettings.speechTiming, countdownMs: 0 },
        },
        competitionType: 'casual',
      },
    })
  ).view;
  return f.seatBotOpponent(room, bot.actorId);
};
const turnOff = (f: RuntimeFixture, userId: string) =>
  f.setBotDebates(userId, false);
const reservations = async (f: RuntimeFixture, actorId: string) =>
  (
    await f.sql`select count(*)::int as n from usage_reservations where actor_id=${actorId} and kind='ai_round'`
  )[0].n as number;

test('the Round freeze refuses a bot debate whose host lost the release, whatever allowance they hold', async () => {
  await withRoomRuntime(
    async (f) => {
      // Built while released: the host holds the Premium-beta allowance too.
      const room = await botRoom(f);
      await turnOff(f, f.host.userId);
      const refusal = await f.operations
        .command(f.host, room.id, {
          type: 'start-round',
          commandId: createId(),
          expectedVersion: room.version,
        })
        .then(
          () => 'started',
          (error: { reason?: string }) => error.reason ?? 'error',
        );
      const after = await f.operations.view(f.host, room.id);
      assert({
        given:
          'a Ready bot Room whose host’s bot-debates override was turned off',
        should:
          'refuse Start as coming soon inside the freeze, reserve nothing, start no Round, and tell the host',
        actual: [
          refusal,
          await reservations(f, f.host.actorId),
          after.roundRef,
          after.botAdmission,
        ],
        expected: ['bot-debates-coming-soon', 0, null, { kind: 'coming-soon' }],
      });
    },
    { ...botAdmissionForTests },
  );
});

test('a bot Round already running when the release turns off goes on normally', async () => {
  await withRoomRuntime(
    async (f) => {
      const room = await botRoom(f);
      const { roundId, operations } = await launchRuntimeRound(f, room);
      await turnOff(f, f.host.userId);
      await operations.tick(roundId);
      const round = (await f.store.getRound(roundId))!;
      const forfeited = await operations
        .command({ kind: 'human', actorId: f.host.actorId }, roundId, {
          version: 1,
          commandId: createId(),
          expectedVersion: round.version,
          command: {
            type: 'forfeit',
            participantId: round.participants.find(
              (p) => p.actorId === f.host.actorId,
            )!.id,
          },
        })
        .then(
          () => 'accepted',
          (error: { reason?: string; code?: string }) =>
            error.reason ?? error.code ?? 'error',
        );
      assert({
        given: 'a launched bot Round, then the host’s release turned off',
        should:
          'keep its one reservation, keep running, and take the host’s own Round command',
        actual: [
          await reservations(f, f.host.actorId),
          isRoundRunning(round.status),
          forfeited,
        ],
        expected: [1, true, 'accepted'],
      });
    },
    { ...botAdmissionForTests },
  );
});
