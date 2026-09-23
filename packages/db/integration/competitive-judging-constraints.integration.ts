import { createId } from '@paralleldrive/cuid2';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { at, digest, rejected, withFixture } from './constraint-helpers';

setupRitewayBun();

const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    'TEST_DATABASE_URL required; never use application database for tests',
  );
if (!new URL(url).pathname.endsWith('_test'))
  throw new Error('Test database name must end in _test');

describe('ballots (DATA-3.1)', () => {
  test('one ballot per judge seat and voiding fields tied to status', async () => {
    await withFixture(url, async (fixture) => {
      const debateId = await fixture.debate();
      const judgeId = await fixture.participant(debateId, 'judge');
      const voider = await fixture.actor();
      const ballot = (overrides: Record<string, unknown>) => ({
        id: createId(),
        debate_id: debateId,
        judge_actor_id: judgeId,
        decision: 'affirmative',
        scores: {},
        reason: 'Stronger evidence',
        status: 'submitted',
        submitted_at: at,
        voided_at: null,
        voided_by_actor_id: null,
        ...overrides,
      });
      const submitted = !(await fixture.rejects('ballots', ballot({})));
      const secondForSeat = await fixture.rejects('ballots', ballot({}));
      const otherJudge = await fixture.participant(debateId, 'judge', 1);
      const voidedWithoutVoider = await fixture.rejects(
        'ballots',
        ballot({ judge_actor_id: otherJudge, status: 'voided', voided_at: at }),
      );
      const voidedWithoutTime = await fixture.rejects(
        'ballots',
        ballot({
          judge_actor_id: otherJudge,
          status: 'voided',
          voided_by_actor_id: voider,
        }),
      );
      const submittedWithVoidFields = await fixture.rejects(
        'ballots',
        ballot({
          judge_actor_id: otherJudge,
          voided_at: at,
          voided_by_actor_id: voider,
        }),
      );
      const badDecision = await fixture.rejects(
        'ballots',
        ballot({ judge_actor_id: otherJudge, decision: 'abstain' }),
      );
      const voided = !(await fixture.rejects(
        'ballots',
        ballot({
          judge_actor_id: otherJudge,
          status: 'voided',
          voided_at: at,
          voided_by_actor_id: voider,
        }),
      ));
      assert({
        given: 'ballots for two judge seats',
        should:
          'accept one submitted and one fully voided ballot; reject a second per seat, half-voided rows and an unknown decision',
        actual: {
          submitted,
          secondForSeat,
          voidedWithoutVoider,
          voidedWithoutTime,
          submittedWithVoidFields,
          badDecision,
          voided,
        },
        expected: {
          submitted: true,
          secondForSeat: true,
          voidedWithoutVoider: true,
          voidedWithoutTime: true,
          submittedWithVoidFields: true,
          badDecision: true,
          voided: true,
        },
      });
    });
  });

  test('a ballot cannot borrow a seat from another debate', async () => {
    await withFixture(url, async (fixture) => {
      const debateA = await fixture.debate();
      const debateB = await fixture.debate();
      const seatInA = await fixture.participant(debateA, 'judge');
      const ballot = (debateId: string) => ({
        id: createId(),
        debate_id: debateId,
        judge_actor_id: seatInA,
        decision: 'draw',
        scores: {},
        reason: 'Even',
        status: 'submitted',
        submitted_at: at,
      });
      const crossDebate = await fixture.rejectedBy('ballots', ballot(debateB));
      const ownDebate = await fixture.rejectedBy('ballots', ballot(debateA));
      assert({
        given: 'a judge seat in debate A used by a ballot naming debate B',
        should:
          'reject through the composite seat key and accept the same seat for debate A',
        actual: { crossDebate, ownDebate },
        expected: {
          crossDebate: 'ballots_judge_seat_fk',
          ownDebate: null,
        },
      });
    });
  });

  test('a debate deletes through its cascade graph', async () => {
    await withFixture(url, async (fixture) => {
      const debateId = await fixture.debate();
      const judgeId = await fixture.participant(debateId, 'judge');
      await fixture.participant(debateId, 'affirmative');
      await fixture.insert('ballots', {
        id: createId(),
        debate_id: debateId,
        judge_actor_id: judgeId,
        decision: 'draw',
        scores: {},
        reason: 'Even',
        status: 'submitted',
        submitted_at: at,
      });
      await fixture.insert(
        'debate_commands',
        {
          command_id: createId(),
          debate_id: debateId,
          actor_id: null,
          service_id: 'foundation-proof',
          type: 'debate.transition',
          payload_digest: digest,
          result: {},
          resulting_version: 3,
          applied_at: at,
        },
        'command_id',
      );
      const deleteRejected = await rejected(() =>
        fixture.sql.unsafe('delete from debates where id = $1', [debateId]),
      );
      const remaining = {
        participants: await fixture.count(
          'debate_participants',
          'debate_id',
          debateId,
        ),
        ballots: await fixture.count('ballots', 'debate_id', debateId),
        commands: await fixture.count('debate_commands', 'debate_id', debateId),
      };
      assert({
        given: 'a debate with participants, a ballot and a command',
        should: 'delete without a RESTRICT error and leave zero child rows',
        actual: { deleteRejected, remaining },
        expected: {
          deleteRejected: false,
          remaining: { participants: 0, ballots: 0, commands: 0 },
        },
      });
    });
  });
});
