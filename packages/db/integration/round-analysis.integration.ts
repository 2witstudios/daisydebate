import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { sampleRoundAnalysisReport as report } from '@daisy/protocol/round-analysis-testing';
import { createId } from '@paralleldrive/cuid2';
import { randomBytes } from 'node:crypto';
import {
  claim,
  completedRound,
  dayAgo,
  listedSeats,
  withCompletedRound,
} from './round-analysis.test-support';
import type { Fixture } from './constraint-helpers';
setupRitewayBun();
requireTestServices(process.env);

const lapse = (fixture: Fixture, participantId: string) =>
  fixture.sql`update round_analyses set lease_expires_at=clock_timestamp() - interval '1 second' where round_participant_id=${participantId}`;

test('each debater seat of a completed Round is analysed once from its freeze, under one lease at a time', async () =>
  withCompletedRound(async ({ fixture, aff, neg, seats, jobs, facts }) => {
    const before = {
      listed: await listedSeats(jobs, dayAgo()),
      recent: await listedSeats(jobs, new Date().toISOString()),
      facts: await facts(aff),
    };
    const first = await jobs.claim(seats.aff, claim);
    const held = await facts(aff);
    if (!first) throw Error('Expected a claim');
    await assertRejects({
      given: 'a token that does not hold the lease',
      should: 'refuse the report with CONFLICT',
      actual: () =>
        jobs.complete(seats.aff, randomBytes(32).toString('base64url'), report),
      code: 'CONFLICT',
    });
    await jobs.recordUsage(seats.aff, first.token, {
      inputTokens: 900,
      outputTokens: 80,
    });
    await jobs.complete(seats.aff, first.token, report);
    const [row] =
      await fixture.sql`select status,attempts,freeze_revision,input_tokens,output_tokens,lease_token_digest from round_analyses where round_participant_id=${aff.id}`;
    assert({
      given: 'a completed Round with frozen lines and two human debaters',
      should:
        'list both seats only from a window that holds them, let a claim read its freeze and seat, and store that seat’s report with its usage',
      actual: {
        before: {
          listed: [aff.id, neg.id].every((id) => before.listed.includes(id)),
          recent: before.recent.includes(aff.id),
          frozen: before.facts.frozen,
          lines: before.facts.lines,
          analysis: before.facts.analysis,
        },
        claimed: {
          lines: first.frozen.utterances.length,
          revision: first.frozen.revision,
          side: first.seat.side,
          history: first.history,
          held: held.analysis?.status,
        },
        row,
        after: {
          affListed: (await listedSeats(jobs, dayAgo())).includes(aff.id),
          negListed: (await listedSeats(jobs, dayAgo())).includes(neg.id),
          retaken: await jobs.claim(seats.aff, claim),
          report: (await facts(aff)).analysis?.report,
          negAnalysis: (await facts(neg)).analysis,
        },
      },
      expected: {
        before: {
          listed: true,
          recent: false,
          frozen: true,
          lines: 2,
          analysis: null,
        },
        claimed: {
          lines: 2,
          revision: 1,
          side: 'affirmative',
          history: [],
          held: 'leased',
        },
        row: {
          status: 'succeeded',
          attempts: 1,
          freeze_revision: 1,
          input_tokens: 900,
          output_tokens: 80,
          lease_token_digest: null,
        },
        after: {
          affListed: false,
          negListed: true,
          retaken: null,
          report,
          negAnalysis: null,
        },
      },
    });
  }));

test('an AI ballot with feedback for both sides never stops a round analysis', async () =>
  withCompletedRound(async ({ fixture, roundId, aff, seats, jobs, facts }) => {
    const judgeActor = createId();
    await fixture.insert('actors', { id: judgeActor, kind: 'bot' });
    const judge = await fixture.seat(roundId, 'judge', 0, judgeActor);
    await fixture.insert('ballots', {
      id: createId(),
      judge_participant_id: judge.id,
      round_id: roundId,
      freeze_revision: 1,
      rubric_version: 'speaker-10@1',
      winner: 'affirmative',
      scores: {},
      reason: 'The affirmative carried access.',
      feedback: {
        affirmative: 'Weigh earlier.',
        negative: 'Answer the access turn.',
      },
      status: 'submitted',
      submitted_at: new Date(1000),
    });
    const listed = (await listedSeats(jobs, dayAgo())).includes(aff.id);
    const claimed = await jobs.claim(seats.aff, claim);
    if (!claimed) throw Error('Expected a claim');
    await jobs.complete(seats.aff, claimed.token, report);
    assert({
      given:
        'a submitted AI ballot carrying judge feedback for both sides of a completed Round',
      should: 'still list, claim and report the debater’s round analysis',
      actual: {
        listed,
        status: (await facts(aff)).analysis?.status,
      },
      expected: { listed: true, status: 'succeeded' },
    });
  }));

test('a debater’s later analysis reads their own earlier skill scores, and only theirs (RA-2)', async () =>
  withCompletedRound(async ({ fixture, aff, seats, jobs }) => {
    // Both seats of the first Round are analysed; the opponent scores 1.
    const theirs = {
      ...report,
      skills: Object.fromEntries(
        Object.entries(report.skills).map(([skill, value]) => [
          skill,
          { ...value, score: 1 },
        ]),
      ) as typeof report.skills,
    };
    for (const [seat, result] of [
      [seats.aff, report],
      [seats.neg, theirs],
    ] as const) {
      const claimed = await jobs.claim(seat, claim);
      if (!claimed) throw Error('Expected a claim');
      await jobs.complete(seat, claimed.token, result);
    }
    // The same affirmative debater then sits a second completed Round.
    const laterRound = await fixture.round();
    const { aff: later } = await completedRound(
      fixture,
      laterRound,
      true,
      undefined,
      aff.actorId,
    );
    const next = await jobs.claim(
      { roundId: laterRound, roundParticipantId: later.id },
      claim,
    );
    assert({
      given:
        'a debater with one earlier analysis whose opponent was also analysed',
      should:
        'give the later claim exactly that debater’s earlier skill scores, never the opponent’s',
      actual: next?.history,
      expected: [
        Object.fromEntries(
          Object.entries(report.skills).map(([skill, { score }]) => [
            skill,
            score,
          ]),
        ),
      ],
    });
    if (!next) throw Error('Expected a claim');
    await jobs.complete(
      { roundId: laterRound, roundParticipantId: later.id },
      next.token,
      report,
    );
    // A Round that completed before both, analysed (or retried) only now.
    const earlierRound = await fixture.round();
    const { aff: earlier } = await completedRound(
      fixture,
      earlierRound,
      true,
      undefined,
      aff.actorId,
    );
    await fixture.sql`update rounds set started_at=started_at - interval '1 day',
      completed_at=completed_at - interval '1 day',
      final_segment_ended_at=final_segment_ended_at - interval '1 day'
      where id=${earlierRound}`;
    const retried = await jobs.claim(
      { roundId: earlierRound, roundParticipantId: earlier.id },
      () => 'claim',
    );
    assert({
      given:
        'the same debater’s Round that completed before both analysed Rounds, analysed only afterwards',
      should: 'read no history: later Rounds are never "earlier" scores',
      actual: retried?.history,
      expected: [],
    });
    await fixture.sql`delete from rounds where id in (${laterRound}, ${earlierRound})`;
  }));

test('a lapsed lease is listed again and the decision retakes or ends it', async () =>
  withCompletedRound(async ({ fixture, aff, seats, jobs, facts }) => {
    await jobs.claim(seats.aff, claim);
    await lapse(fixture, aff.id);
    const listed = (await listedSeats(jobs, new Date().toISOString())).includes(
      aff.id,
    );
    const second = await jobs.claim(seats.aff, claim);
    await lapse(fixture, aff.id);
    const ended = await jobs.claim(seats.aff, () => 'fail');
    const [row] =
      await fixture.sql`select status,attempts,lease_token_digest from round_analyses where round_participant_id=${aff.id}`;
    assert({
      given: 'a lapsed first attempt, retaken, then lapsed and ended',
      should:
        'list it whatever its age, take a second attempt, then end the job failed',
      actual: {
        listed,
        attempt: second?.attempt,
        ended,
        row,
        facts: (await facts(aff)).analysis?.status,
      },
      expected: {
        listed: true,
        attempt: 2,
        ended: null,
        row: { status: 'failed', attempts: 2, lease_token_digest: null },
        facts: 'failed',
      },
    });
  }));

test('a Round without a frozen transcript is never a candidate', async () =>
  withCompletedRound(
    async ({ aff, jobs, facts }) => {
      assert({
        given: 'a completed Round with lines but no freeze',
        should: 'not list its seats, and report it unfrozen',
        actual: {
          listed: (await listedSeats(jobs, dayAgo())).includes(aff.id),
          frozen: (await facts(aff)).frozen,
        },
        expected: { listed: false, frozen: false },
      });
    },
    { frozen: false },
  ));

test('a frozen Round with no lines is never a candidate', async () =>
  withCompletedRound(async ({ fixture, roundId, aff, jobs, facts }) => {
    await fixture.sql`delete from utterances where round_id=${roundId}`;
    assert({
      given: 'a completed, frozen Round with no transcript lines',
      should: 'not hold a scan batch place, and report no lines',
      actual: {
        listed: (await listedSeats(jobs, dayAgo())).includes(aff.id),
        lines: (await facts(aff)).lines,
      },
      expected: { listed: false, lines: 0 },
    });
  }));
