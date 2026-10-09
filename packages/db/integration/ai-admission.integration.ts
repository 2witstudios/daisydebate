import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { createDatabase } from '../src';
import { referenceAiJudge, referenceBots } from '../src/reference-formats';
import { aiPracticeRoom } from '../src/ai-practice-admission.test-support';
import { withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

type Fixture = Parameters<Parameters<typeof withFixture>[1]>[0];

type Admission = Parameters<
  ReturnType<typeof createDatabase>['admitAiPractice']
>[0];

const withAdmission = async (
  run: (input: {
    fixture: Fixture;
    db: ReturnType<typeof createDatabase>;
    make: (actorId: string, limits: Admission['limits']) => Admission;
  }) => Promise<void>,
) => {
  await withFixture(url, async (fixture) => {
    const db = createDatabase({ url, nextActorId: createId });
    try {
      const format = await db.getFormat('one-on-one');
      if (!format) throw new Error('reference format missing');
      const make = (
        actorId: string,
        limits: Admission['limits'],
      ): Admission => {
        const roomId = createId();
        const roundId = createId();
        fixture.track('rooms', roomId);
        fixture.track('rounds', roundId);
        return {
          room: aiPracticeRoom(roomId, format.id, format.version, actorId),
          seats: [
            { id: createId(), actorId, role: 'affirmative' },
            {
              id: createId(),
              actorId: referenceBots[0]!.actorId,
              role: 'negative',
            },
            {
              id: createId(),
              actorId: referenceAiJudge.actorId,
              role: 'judge',
            },
          ],
          roundId,
          actorId,
          limits,
          reservationId: createId(),
          resolution: 'Admission must be atomic',
          since: new Date(0),
        };
      };
      await run({ fixture, db, make });
    } finally {
      await db.close();
    }
  });
};

test('AI practice admission serializes both limits and leaves no partial room', async () => {
  await withAdmission(async ({ fixture, db, make }) => {
    const actorId = await fixture.actor();
    const before = await db.countLiveRounds();
    const a = make(actorId, { live: before + 1, perDay: 1 });
    const b = make(actorId, { live: before + 1, perDay: 1 });
    const [first, second] = await Promise.allSettled([
      db.admitAiPractice(a),
      db.admitAiPractice(b),
    ]);
    assert({
      given: 'two admissions racing for one remaining global and personal slot',
      should: 'commit exactly one complete assembly and reservation',
      actual: [first.status, second.status].sort(),
      expected: ['fulfilled', 'rejected'],
    });
    assert({
      given: 'the refused admission',
      should: 'leave no additional live practice round',
      actual: (await db.countLiveRounds()) - before,
      expected: 1,
    });
    const roomCount =
      (await fixture.count('rooms', 'id', a.room.id)) +
      (await fixture.count('rooms', 'id', b.room.id));
    const roundCount =
      (await fixture.count('rounds', 'id', a.roundId)) +
      (await fixture.count('rounds', 'id', b.roundId));
    assert({
      given: 'the atomic admission pair',
      should: 'persist one room and one round',
      actual: { roomCount, roundCount },
      expected: { roomCount: 1, roundCount: 1 },
    });
  });
});

test('admission durably abandons expired practices and closes their segments', async () => {
  await withAdmission(async ({ fixture, db, make: admission }) => {
    const make = async () =>
      admission(await fixture.actor(), { live: 2, perDay: 20 });
    const scheduled = await make();
    const active = await make();
    await db.admitAiPractice(scheduled);
    await db.admitAiPractice(active);
    await fixture.sql.unsafe(
      "update rounds set updated_at = statement_timestamp() - interval '16 minutes' where id = $1",
      [scheduled.roundId],
    );
    await fixture.sql.unsafe(
      "update rounds set status = 'active', current_stage = 'live', started_at = statement_timestamp() - interval '3 hours', updated_at = statement_timestamp() - interval '3 hours' where id = $1",
      [active.roundId],
    );
    const segmentId = createId();
    await fixture.insert('round_segments', {
      id: segmentId,
      round_id: active.roundId,
      sequence: 0,
      type: 'speech',
      rules_segment_key: 'AC',
      started_at: new Date('2026-01-01T00:00:00.000Z'),
      duration_ms: 300_000,
    });
    const replacement = await make();
    await db.admitAiPractice({
      ...replacement,
      limits: { live: 1, perDay: 20 },
    });
    const old = await Promise.all([
      db.getRound(scheduled.roundId),
      db.getRound(active.roundId),
    ]);
    assert({
      given: 'expired scheduled and active sessions filling global capacity',
      should:
        'abandon both with durable completion instants before admitting a replacement',
      actual: old.map((row) => [row?.status, row?.completedAt !== null]),
      expected: [
        ['abandoned', true],
        ['abandoned', true],
      ],
    });
    assert({
      given: 'the abandoned active round',
      should: 'close its interval and release global capacity',
      actual: [
        old[1]?.segments[0]?.endedAt !== null,
        await db.countLiveRounds(),
      ],
      expected: [true, 1],
    });
  });
});
