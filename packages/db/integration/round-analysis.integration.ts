import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { sampleRoundAnalysisReport as report } from '@daisy/protocol/round-analysis-testing';
import { createId } from '@paralleldrive/cuid2';
import {
  completedRound,
  deliverAnalysis,
  listedSeats,
  withCompletedRound,
} from './round-analysis.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('only an explicit request admits one seat, counts its first call, and reuses its finished identity', async () =>
  withCompletedRound(
    async ({ fixture, aff, neg, seats, jobs, request, facts }) => {
      assert({
        given: 'two entitled human seats with frozen evidence but no request',
        should: 'discover neither and create no analysis identity',
        actual: [await listedSeats(jobs), (await facts(aff)).analysis],
        expected: [[], null],
      });
      const admitted = await request(seats.aff);
      const replay = await request(seats.aff);
      const first = await jobs.claim(seats.aff);
      if (!first) throw Error('Expected claim');
      const [uncounted] =
        await fixture.sql`select state from usage_reservations where round_id=${seats.aff.roundId} and kind='round_analysis'`;
      assert({
        given: 'a request replay and claimed lease before any model call',
        should: 'retain one request and reservation without counting',
        actual: [
          JSON.stringify(admitted) === JSON.stringify(replay),
          uncounted.state,
          await jobs.claim(seats.aff),
        ],
        expected: [true, { kind: 'reserved' }, null],
      });
      assert({
        given: 'wrong token, then first and duplicate dispatch',
        should: 'admit exactly one provider invocation',
        actual: [
          await jobs.dispatch(seats.aff, first.callId, 'w'.repeat(43)),
          await jobs.dispatch(seats.aff, first.callId, first.token),
          await jobs.dispatch(seats.aff, first.callId, first.token),
        ],
        expected: [null, true, null],
      });
      await jobs.observe(seats.aff, first.callId, first.token, {
        kind: 'received',
        inputTokens: 900,
        outputTokens: 80,
      });
      await jobs.complete(seats.aff, first.callId, first.token, report);
      const done = (await facts(aff)).analysis;
      const [usage] =
        await fixture.sql`select state from usage_reservations where round_id=${seats.aff.roundId} and kind='round_analysis'`;
      assert({
        given: 'a delivered requested report and the other unrequested seat',
        should:
          'settle delivery and never automatically generate for the opponent or reopen this identity',
        actual: [
          done?.kind,
          done && 'report' in done ? done.report : null,
          usage.state.kind,
          (await facts(neg)).analysis,
          (await request(seats.aff)).kind,
          await jobs.claim(seats.aff),
        ],
        expected: ['succeeded', report, 'delivered', null, 'succeeded', null],
      });
    },
  ));

test('ballots remain independent of a requested analysis', async () =>
  withCompletedRound(
    async ({ fixture, roundId, aff, seats, jobs, request, facts }) => {
      const actor = createId();
      await fixture.insert('actors', { id: actor, kind: 'bot' });
      const judge = await fixture.seat(roundId, 'judge', 0, actor);
      await fixture.insert('ballots', {
        id: createId(),
        judge_participant_id: judge.id,
        round_id: roundId,
        freeze_revision: 1,
        rubric_version: 'speaker-10@1',
        winner: 'affirmative',
        scores: {},
        reason: 'Affirmative wins',
        feedback: {
          affirmative: 'Weigh earlier.',
          negative: 'Answer the turn.',
        },
        submitted_at: new Date(1000),
      });
      const before = JSON.stringify(
        await fixture.sql`select * from ballots where round_id=${roundId}`,
      );
      await request(seats.aff);
      await deliverAnalysis(jobs, seats.aff, report);
      assert({
        given:
          'an existing AI ballot with feedback and a separate user request',
        should: 'deliver analysis without reading or changing the ballot',
        actual: [
          (await facts(aff)).analysis?.kind,
          JSON.stringify(
            await fixture.sql`select * from ballots where round_id=${roundId}`,
          ) === before,
        ],
        expected: ['succeeded', true],
      });
    },
  ));

test('requested history reads only the same debater’s earlier completed reports', async () =>
  withCompletedRound(async ({ fixture, aff, seats, jobs, request }) => {
    const scores = Object.fromEntries(
      Object.entries(report.skills).map(([skill, { score }]) => [skill, score]),
    );
    await request(seats.neg);
    await deliverAnalysis(jobs, seats.neg, {
      ...report,
      skills: Object.fromEntries(
        Object.entries(report.skills).map(([skill, value]) => [
          skill,
          { ...value, score: 1 },
        ]),
      ) as typeof report.skills,
    });
    const later = async () => {
      const roundId = await fixture.round();
      const { aff: seat } = await completedRound(
        fixture,
        roundId,
        true,
        undefined,
        aff.actorId,
      );
      return { roundId, roundParticipantId: seat.id };
    };
    const b = await later();
    await request(b);
    const historyB = (await deliverAnalysis(jobs, b, report)).history;
    await request(seats.aff);
    const historyA = (await deliverAnalysis(jobs, seats.aff, report)).history;
    const c = await later();
    await request(c);
    const historyC = (await jobs.claim(c))?.history;
    assert({
      given:
        'Round B delivered before earlier Round A, then Round C, with A’s opponent also analysed',
      should: 'read only the same debater’s earlier scores',
      actual: [historyB, historyA, historyC],
      expected: [[], [], [scores, scores]],
    });
    await fixture.sql`delete from rounds where id in (${b.roundId},${c.roundId})`;
  }));

for (const evidence of ['no-freeze', 'no-lines', 'no-visibility'] as const)
  test(`request refuses ${evidence} without creating ledger or work`, async () =>
    withCompletedRound(
      async ({ fixture, roundId, seats, jobs, request }) => {
        if (evidence === 'no-lines')
          await fixture.sql`delete from utterances where round_id=${roundId}`;
        if (evidence === 'no-visibility')
          await fixture.sql`update rounds set visibility=null where id=${roundId}`;
        await assertRejects({
          given: evidence,
          should: 'refuse unavailable evidence/authority',
          code: evidence === 'no-visibility' ? 'NOT_FOUND' : 'CONFLICT',
          actual: () => request(seats.aff),
        });
        const [rows] =
          await fixture.sql`select (select count(*)::integer from round_analyses where round_id=${roundId}) as work,(select count(*)::integer from usage_reservations where round_id=${roundId}) as usage`;
        assert({
          given: 'the refused request',
          should: 'leave both stores untouched and discover nothing',
          actual: [rows, await listedSeats(jobs)],
          expected: [{ work: 0, usage: 0 }, []],
        });
      },
      { frozen: evidence !== 'no-freeze' },
    ));
