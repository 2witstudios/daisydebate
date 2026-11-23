import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { roomViewSchema } from '@daisy/protocol/room-read';
import { judgeSeat, negativeSide, sideSeat } from '@daisy/protocol/seats';
import { createRoomHttpFixture } from './room-http.test-support';
import { withSql } from './fixtures';
import { deleteOrphanNotificationSignals } from './notification-signals.test-support';
import { roomComposition } from '../src/features/room-runtime/composition';

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
