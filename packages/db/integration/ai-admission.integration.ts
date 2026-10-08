import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { createDatabase } from '../src';
import { referenceAiJudge, referenceBots } from '../src/reference-formats';
import { aiPracticeRoom } from '../src/ai-practice-admission.test-support';
import { withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('AI practice admission serializes both limits and leaves no partial room', async () => {
  await withFixture(url, async (fixture) => {
    const db = createDatabase({ url, nextActorId: createId });
    try {
      const format = await db.getFormat('one-on-one');
      if (!format) throw new Error('reference format missing');
      const actorId = await fixture.actor();
      const before = await db.countLiveRounds();
      const make = () => {
        const roomId = createId();
        const roundId = createId();
        fixture.track('rooms', roomId);
        fixture.track('rounds', roundId);
        return {
          room: aiPracticeRoom(roomId, format.id, format.version),
          seats: [
            { id: createId(), actorId, role: 'affirmative' as const },
            {
              id: createId(),
              actorId: referenceBots[0]!.actorId,
              role: 'negative' as const,
            },
            {
              id: createId(),
              actorId: referenceAiJudge.actorId,
              role: 'judge' as const,
            },
          ] as const,
          roundId,
          resolution: 'Admission must be atomic',
          reservationId: createId(),
          actorId,
          since: new Date('2026-10-06T00:00:00.000Z'),
          limits: { live: before + 1, perDay: 1 },
        };
      };
      const a = make();
      const b = make();
      const [first, second] = await Promise.allSettled([
        db.admitAiPractice(a),
        db.admitAiPractice(b),
      ]);
      assert({
        given:
          'two admissions racing for one remaining global and personal slot',
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
    } finally {
      await db.close();
    }
  });
});
