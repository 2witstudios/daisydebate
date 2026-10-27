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

test('a debater’s analysis reads only their own analyses of Rounds that completed earlier (RA-2)', async () =>
  withCompletedRound(async ({ fixture, aff, seats, jobs }) => {
    const scoresOf = (result: typeof report) =>
      Object.fromEntries(
        Object.entries(result.skills).map(([skill, { score }]) => [
          skill,
          score,
        ]),
      );
    const analyse = async (
      seat: { roundId: string; roundParticipantId: string },
      result: typeof report,
    ) => {
      const claimed = await jobs.claim(seat, claim);
      if (!claimed) throw Error('Expected a claim');
      await jobs.complete(seat, claimed.token, result);
      return claimed.history;
    };
    // Round A's opponent is analysed first; their scores are never the debater's.
    const theirs = {
      ...report,
      skills: Object.fromEntries(
        Object.entries(report.skills).map(([skill, value]) => [
          skill,
          { ...value, score: 1 },
        ]),
      ) as typeof report.skills,
    };
    await analyse(seats.neg, theirs);
    const sitAgain = async () => {
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
    // The same debater's later Round B is analysed before Round A.
    const roundB = await sitAgain();
    const historyB = await analyse(roundB, report);
    const historyA = await analyse(seats.aff, report);
    // A third Round C reads both earlier analyses of this debater.
    const roundC = await sitAgain();
    const historyC = (await jobs.claim(roundC, claim))?.history;
    assert({
      given:
        'a debater analysed in a later Round B before their earlier Round A, then in Round C, with A’s opponent analysed too',
      should:
        'give B no history, give A none (B completed later), and give C both of the debater’s own earlier scores and never the opponent’s',
      actual: { historyB, historyA, historyC },
      expected: {
        historyB: [],
        historyA: [],
        historyC: [scoresOf(report), scoresOf(report)],
      },
    });
    await fixture.sql`delete from rounds where id in (${roundB.roundId}, ${roundC.roundId})`;
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

test('a lapsed lease is listed even when its debater is no longer entitled, so its claim can end it', async () =>
  withCompletedRound(async ({ fixture, aff, seats, jobs, facts }) => {
    await jobs.claim(seats.aff, claim);
    await lapse(fixture, aff.id);
    const listed = (
      await jobs.scan(64, new Date().toISOString(), () => false)
    ).map((seat) => seat.roundParticipantId);
    const ended = await jobs.claim(seats.aff, () => 'fail');
    assert({
      given: 'a lapsed lease and a feature that no longer authorizes the seat',
      should: 'list it anyway, then let the decision end it failed',
      actual: {
        listed: listed.includes(aff.id),
        ended,
        status: (await facts(aff)).analysis?.status,
      },
      expected: { listed: true, ended: null, status: 'failed' },
    });
  }));

test('a completed Round without a visibility is never read by the scan', async () =>
  withCompletedRound(async ({ fixture, roundId, aff, jobs }) => {
    await fixture.sql`update rounds set visibility=null where id=${roundId}`;
    assert({
      given: 'a roomless completed Round with no visibility',
      should: 'scan without failing and never list its seats',
      actual: (await listedSeats(jobs, dayAgo())).includes(aff.id),
      expected: false,
    });
  }));
