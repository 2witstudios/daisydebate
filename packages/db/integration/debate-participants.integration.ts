import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { rejected, rejectedBy, withFixture } from './constraint-helpers';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

/** The named constraint a statement was refused by, or null when accepted. */
const constraintOf = (attempt: () => Promise<unknown>) => rejectedBy(attempt);

/**
 * ADR 0058 §2: `round_participants` is the authoritative seat record, with
 * a surrogate id. The database enforces seat and actor uniqueness per
 * round; seat COMPLETENESS against the frozen rules is the write-path
 * invariant `startRound` owns (a CHECK cannot read jsonb against rows).
 */
test('round_participants is the authoritative seat record', async () => {
  await withFixture(url, async (fixture) => {
    const roundId = await fixture.round();
    const [first, second, third] = [createId(), createId(), createId()];
    await fixture.insert(
      'round_participants',
      {
        id: first,
        round_id: roundId,
        actor_id: await fixture.actor(),
        role: 'affirmative',
        slot: 0,
      },
      'id',
    );
    const sameActor = await fixture.rejects(
      'round_participants',
      {
        id: second,
        round_id: roundId,
        actor_id: (
          (await fixture.sql.unsafe(
            'select actor_id from round_participants where id = $1',
            [first],
          )) as Array<{ actor_id: string }>
        )[0]!.actor_id,
        role: 'negative',
        slot: 0,
      },
      'id',
    );
    const sameSeat = await fixture.rejects(
      'round_participants',
      {
        id: second,
        round_id: roundId,
        actor_id: await fixture.actor(),
        role: 'affirmative',
        slot: 0,
      },
      'id',
    );
    const unknownRole = await fixture.rejects(
      'round_participants',
      {
        id: second,
        round_id: roundId,
        actor_id: await fixture.actor(),
        role: 'spectator',
        slot: 0,
      },
      'id',
    );
    const negativeSlot = await fixture.rejects(
      'round_participants',
      {
        id: second,
        round_id: roundId,
        actor_id: await fixture.actor(),
        role: 'negative',
        slot: -1,
      },
      'id',
    );
    const missingRound = await fixture.rejects(
      'round_participants',
      {
        id: second,
        round_id: createId(),
        actor_id: await fixture.actor(),
        role: 'negative',
        slot: 0,
      },
      'id',
    );
    const surrogate = !(await fixture.rejects(
      'round_participants',
      {
        id: third,
        round_id: roundId,
        actor_id: await fixture.actor(),
        role: 'judge',
        slot: 0,
      },
      'id',
    ));
    const witness =
      (
        (await fixture.sql.unsafe(
          `select indexname from pg_indexes
             where tablename = 'round_participants'
               and indexname = 'round_participants_id_round_unique'`,
        )) as Array<{ indexname: string }>
      )[0]?.indexname ?? null;
    assert({
      given: 'seats varying actor, seat, role, slot, round and surrogate id',
      should:
        'enforce one actor and one occupant per round seat, closed roles, non-negative slots and an existing round, and carry the (id, round_id) key utterances reference as their consistency witness',
      actual: {
        sameActor,
        sameSeat,
        unknownRole,
        negativeSlot,
        missingRound,
        surrogate,
        witness,
      },
      expected: {
        sameActor: true,
        sameSeat: true,
        unknownRole: true,
        negativeSlot: true,
        missingRound: true,
        surrogate: true,
        witness: 'round_participants_id_round_unique',
      },
    });
  });
});

/**
 * ADR 0058 §6: a seat carrying a submitted ballot cannot be deleted —
 * the FK is RESTRICT. Retirement is voiding, which records who and when.
 */
test('a judge seat with a submitted ballot is RESTRICTed from deletion', async () => {
  await withFixture(url, async (fixture) => {
    const roundId = await fixture.round();
    const seat = await fixture.seat(roundId, 'judge');
    await fixture.insert(
      'ballots',
      {
        id: createId(),
        judge_participant_id: seat.id,
        rubric_version: 'speaker-10@1',
        winner: 'affirmative',
        scores: {
          affirmative: Object.fromEntries(
            [
              'thesis',
              'framework',
              'analysis',
              'refutation',
              'impact',
              'weighing',
              'questioning',
              'answering',
              'organization',
              'delivery',
            ].map((c) => [c, 3]),
          ),
          negative: Object.fromEntries(
            [
              'thesis',
              'framework',
              'analysis',
              'refutation',
              'impact',
              'weighing',
              'questioning',
              'answering',
              'organization',
              'delivery',
            ].map((c) => [c, 3]),
          ),
        },
        reason: 'probe',
        status: 'submitted',
        submitted_at: new Date(),
      },
      'id',
    );
    const seatDelete = await constraintOf(
      () => fixture.sql`delete from round_participants where id = ${seat.id}`,
    );
    const roundDelete = await rejected(
      () => fixture.sql`delete from rounds where id = ${roundId}`,
    );
    assert({
      given: 'a judge seat holding a submitted ballot',
      should:
        'refuse deleting the seat directly and refuse the round delete that would cascade into it',
      actual: {
        seatDelete,
        roundDelete: roundDelete !== null,
      },
      expected: {
        seatDelete: 'ballots_judge_seat_fk',
        roundDelete: true,
      },
    });
  });
});
