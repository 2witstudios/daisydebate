import { createId } from '@paralleldrive/cuid2';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { at, digest, rejected, withFixture } from './constraint-helpers';
import { requireTestServices } from '@daisy/config';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

/**
 * A ballot row in the shared contract (ADR 0058 §6): it names its judge
 * *seat*, not a judge actor, and one side wins — there are no draws.
 */
const ballot = (
  judgeSeatId: string,
  overrides: Record<string, unknown> = {},
) => ({
  id: createId(),
  judge_participant_id: judgeSeatId,
  rubric_version: 'speaker-10@1',
  winner: 'affirmative',
  scores: {
    affirmative: {
      thesis: 3,
      framework: 3,
      analysis: 3,
      refutation: 3,
      impact: 3,
      weighing: 3,
      questioning: 3,
      answering: 3,
      organization: 3,
      delivery: 3,
    },
    negative: {
      thesis: 2,
      framework: 2,
      analysis: 2,
      refutation: 2,
      impact: 2,
      weighing: 2,
      questioning: 2,
      answering: 2,
      organization: 2,
      delivery: 2,
    },
  },
  reason: 'Stronger evidence',
  status: 'submitted',
  submitted_at: at,
  voided_at: null,
  voided_by_actor_id: null,
  ...overrides,
});

describe('ballots (DATA-3.1)', () => {
  test('one ballot per judge seat and voiding fields tied to status', async () => {
    await withFixture(url, async (fixture) => {
      const roundId = await fixture.round();
      const seat = await fixture.seat(roundId, 'judge');
      const voider = await fixture.actor();
      const submitted = !(await fixture.rejects('ballots', ballot(seat.id)));
      const secondForSeat = await fixture.rejects('ballots', ballot(seat.id));
      const otherJudge = await fixture.seat(roundId, 'judge', 1);
      const voidedWithoutVoider = await fixture.rejects(
        'ballots',
        ballot(otherJudge.id, { status: 'voided', voided_at: at }),
      );
      const voidedWithoutTime = await fixture.rejects(
        'ballots',
        ballot(otherJudge.id, {
          status: 'voided',
          voided_by_actor_id: voider,
        }),
      );
      const submittedWithVoidFields = await fixture.rejects(
        'ballots',
        ballot(otherJudge.id, { voided_at: at, voided_by_actor_id: voider }),
      );
      const badWinner = await fixture.rejects(
        'ballots',
        ballot(otherJudge.id, { winner: 'abstain' }),
      );
      const voidedBeforeSubmitted = await fixture.rejects(
        'ballots',
        ballot(otherJudge.id, {
          status: 'voided',
          voided_at: new Date(at.getTime() - 60_000),
          voided_by_actor_id: voider,
        }),
      );
      const voided = !(await fixture.rejects(
        'ballots',
        ballot(otherJudge.id, {
          status: 'voided',
          voided_at: at,
          voided_by_actor_id: voider,
        }),
      ));
      assert({
        given: 'ballots for two judge seats',
        should:
          'accept one submitted and one fully voided ballot; reject a second per seat, half-voided rows, a void before submission and an unknown winner',
        actual: {
          submitted,
          secondForSeat,
          voidedWithoutVoider,
          voidedWithoutTime,
          submittedWithVoidFields,
          badWinner,
          voidedBeforeSubmitted,
          voided,
        },
        expected: {
          submitted: true,
          secondForSeat: true,
          voidedWithoutVoider: true,
          voidedWithoutTime: true,
          submittedWithVoidFields: true,
          badWinner: true,
          voidedBeforeSubmitted: true,
          voided: true,
        },
      });
    });
  });

  test('a ballot cannot borrow a seat from another round', async () => {
    await withFixture(url, async (fixture) => {
      const roundA = await fixture.round();
      const seatInA = await fixture.seat(roundA, 'judge');
      // The seat id is unique per round, so naming round A's seat is what
      // makes the ballot belong to round A; there is no round column to
      // contradict it with.
      const foreignSeat = await fixture.rejectedBy(
        'ballots',
        ballot(createId()),
      );
      const ownSeat = await fixture.rejectedBy('ballots', ballot(seatInA.id));
      assert({
        given: 'a judge seat in round A, and an id belonging to no seat',
        should: 'accept the seat and refuse the stranger outright',
        actual: { foreignSeat, ownSeat },
        expected: {
          foreignSeat: 'ballots_judge_seat_fk',
          ownSeat: null,
        },
      });
    });
  });

  test('a round deletes through its cascade graph', async () => {
    await withFixture(url, async (fixture) => {
      const roundId = await fixture.round();
      await fixture.seat(roundId, 'judge');
      await fixture.participant(roundId, 'affirmative');
      await fixture.insert(
        'round_commands',
        {
          command_id: createId(),
          round_id: roundId,
          actor_id: null,
          service_id: 'foundation-proof',
          type: 'start',
          payload_digest: digest,
          result: {},
          resulting_version: 3,
          applied_at: at,
        },
        'command_id',
      );
      const deleteRejected = await rejected(() =>
        fixture.sql.unsafe('delete from rounds where id = $1', [roundId]),
      );
      const remaining = {
        participants: await fixture.count(
          'round_participants',
          'round_id',
          roundId,
        ),
        commands: await fixture.count('round_commands', 'round_id', roundId),
      };
      // No ballot here on purpose: a submitted ballot RESTRICTs its judge
      // seat, so it blocks the cascade by design (ADR 0058 §8) and that case
      // is asserted where it belongs, in debate-participants.integration.ts.
      assert({
        given: 'a round with seats and a command, and no submitted ballot',
        should: 'delete without a RESTRICT error and leave zero child rows',
        actual: { deleteRejected, remaining },
        expected: {
          deleteRejected: false,
          remaining: { participants: 0, commands: 0 },
        },
      });
    });
  });
});
