import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { roundTranscriptPrivacyAdopter } from '../src/round-transcript-privacy';
import { transcriptRetention } from '../src/transcript-retention';
import type { Fixture } from './constraint-helpers';
import { syntheticCaseMap } from '../src/testing-judging';
import { validRules } from './round-fixtures';
import {
  syntheticPendingBallot as pending,
  withJudgingJob,
} from './round-judging.test-support';
setupRitewayBun();
requireTestServices(process.env);

const recordedAt = '2026-01-01T00:00:00.000Z';

/**
 * Two human debaters who each said one line before the Round freezes.
 */
async function spokenRound(fixture: Fixture, roundId: string, at: string) {
  const userId = await fixture.user();
  const subject = { userId, actorId: await fixture.actor(userId) };
  const speaker = await fixture.seat(
    roundId,
    'affirmative',
    0,
    subject.actorId,
  );
  const other = await fixture.seat(roundId, 'negative');
  const segmentId = createId();
  const rule = validRules.segments.find((rule) => rule.type === 'speech')!;
  await fixture.insert('round_segments', {
    id: segmentId,
    round_id: roundId,
    sequence: 0,
    type: 'speech',
    rules_segment_key: rule.key,
    started_at: new Date(at),
    duration_ms: rule.durationMs,
  });
  const lines = { subject: createId(), other: createId() };
  for (const [sequence, id, seat] of [
    [0, lines.subject, speaker.id],
    [1, lines.other, other.id],
  ] as const)
    await fixture.sql`insert into utterances(id,round_id,segment_id,round_participant_id,sequence,text,created_at) values(${id},${roundId},${segmentId},${seat},${sequence},'a private line',${at}::timestamptz)`;
  return { subject, lines, roundId };
}

/** The validated response is cached only after its freeze and job exist. */
async function pendingJudgment(
  fixture: Fixture,
  target: { roundId: string; judgeParticipantId: string },
  at: string,
) {
  const { roundId, judgeParticipantId } = target;
  const runId = createId();
  await fixture.insert('agent_runs', {
    id: runId,
    round_participant_id: judgeParticipantId,
    kind: 'judging',
    provider: 'synthetic-retention-fixture',
    started_at: new Date(at),
  });
  await fixture.sql.unsafe(
    'update round_judging_jobs set attempts=1,pending_ballot=$1,pending_ballot_agent_run_id=$2,pending_ballot_epoch=1,pending_ballot_received_at=$3 where round_id=$4 and judge_participant_id=$5',
    [pending, runId, at, roundId, judgeParticipantId],
  );
  const state = async () => {
    const [job] =
      await fixture.sql`select status,pending_ballot is null as cleared,case_map is not null as stages from round_judging_jobs where round_id=${roundId}`;
    const left: { id: string }[] =
      await fixture.sql`select id from utterances where round_id=${roundId} order by sequence`;
    return {
      job: { status: job.status, cleared: job.cleared, stages: job.stages },
      utterances: left.map((row) => row.id),
    };
  };
  return state;
}

const withSpokenRound = (
  at: string,
  work: (
    input: Awaited<ReturnType<typeof spokenRound>> & {
      fixture: Fixture;
      state: Awaited<ReturnType<typeof pendingJudgment>>;
    },
  ) => Promise<void>,
) => {
  let spoken: Awaited<ReturnType<typeof spokenRound>> | undefined;
  return withJudgingJob(
    async ({ fixture, target }) => {
      if (!spoken) throw new Error('Expected pre-freeze transcript setup');
      const state = await pendingJudgment(fixture, target, at);
      await work({ fixture, ...spoken, state });
    },
    'complete',
    async (fixture, target) => {
      spoken = await spokenRound(fixture, target.roundId, at);
    },
  );
};

test('transcript retention removes utterances and pending judging responses 180 days old, not before', async () =>
  withSpokenRound(recordedAt, async ({ fixture, lines, state }) => {
    const retention = transcriptRetention({
      database: drizzle({ client: fixture.sql }),
    });
    const sweep = (before: string) =>
      Promise.all([
        retention.purgeExpiredUtterances({ before, limit: 10 }),
        retention.clearExpiredPendingBallots({ before, limit: 10 }),
      ]);
    const early = await sweep(recordedAt);
    const kept = await state();
    const due = await sweep('2026-01-01T00:00:00.001Z');
    assert({
      given: 'a cutoff at the recording instant, then one just after it',
      should:
        'keep everything at the boundary, then delete both lines and discard the cached response by failing its job',
      actual: { early, kept, due, after: await state() },
      expected: {
        early: [0, 0],
        kept: {
          job: { status: 'queued', cleared: false, stages: true },
          utterances: [lines.subject, lines.other],
        },
        due: [2, 1],
        after: {
          job: { status: 'failed', cleared: true, stages: true },
          utterances: [],
        },
      },
    });
  }));

test('judging stage records are cleared 180 days after receipt, not before (DEC-393)', () =>
  withJudgingJob(async ({ fixture, roundId }) => {
    await fixture.sql`update round_judging_jobs set first_ballot_failed=false,
      first_ballot=${JSON.stringify(pending)}::text::jsonb,first_ballot_received_at=${recordedAt}::timestamptz,
      case_map_received_at=${recordedAt}::timestamptz where round_id=${roundId}`;
    const retention = transcriptRetention({
      database: drizzle({ client: fixture.sql }),
    });
    const stages = async () => {
      const [job] =
        await fixture.sql`select first_ballot is not null as first,case_map is not null as map from round_judging_jobs where round_id=${roundId}`;
      return { first: job.first, map: job.map };
    };
    const early = await retention.clearExpiredJudgingStages({
      before: recordedAt,
      limit: 10,
    });
    const kept = await stages();
    const due = await retention.clearExpiredJudgingStages({
      before: '2026-01-01T00:00:00.001Z',
      limit: 10,
    });
    assert({
      given: 'a first pass and a case map received at the recording instant',
      should: 'keep both at the boundary, then clear both just after it',
      actual: { early, kept, due, after: await stages() },
      expected: {
        early: 0,
        kept: { first: true, map: true },
        due: 1,
        after: { first: false, map: false },
      },
    });
  }));

test('a ranked Round keeps its transcript past the window, as its waiver says', () =>
  withSpokenRound(recordedAt, async ({ fixture, lines, roundId, state }) => {
    await fixture.sql`update rounds set competition_type='ranked', format_id='freestyle',
      ladder_id='freestyle', preset_version=1 where id=${roundId}`;
    const retention = transcriptRetention({
      database: drizzle({ client: fixture.sql }),
    });
    assert({
      given: 'lines of a ranked Round well past 180 days',
      should: 'delete none of them',
      actual: [
        await retention.purgeExpiredUtterances({
          before: '2027-01-01T00:00:00.000Z',
          limit: 10,
        }),
        (await state()).utterances,
      ],
      expected: [0, [lines.subject, lines.other]],
    });
  }));

test('subject erasure removes their transcript lines and every pending judgment of their Rounds', async () =>
  withSpokenRound(
    new Date().toISOString(),
    async ({ fixture, subject, lines, state }) => {
      const now = new Date().toISOString();
      const database = drizzle({ client: fixture.sql });
      const exported = await database.transaction((tx) =>
        roundTranscriptPrivacyAdopter.export(tx, subject),
      );
      await database.transaction((tx) =>
        roundTranscriptPrivacyAdopter.erase(tx, subject, { now }),
      );
      assert({
        given:
          "an erased debater's line, the other debater's line, the AI judge's cached response and its stage records",
        should:
          "export only the subject's own line, then delete it, keep the other debater's, discard the response by failing its job and clear its first pass and case map",
        actual: {
          exported: exported.utterances?.map((row) => row.id),
          after: await state(),
        },
        expected: {
          exported: [lines.subject],
          after: {
            job: { status: 'failed', cleared: true, stages: false },
            utterances: [lines.other],
          },
        },
      });
    },
  ));

test('subject erasure ends open judging work whose stage records it clears, so nothing is bought again (ADR 0125)', () => {
  let spoken: Awaited<ReturnType<typeof spokenRound>> | undefined;
  return withJudgingJob(
    async ({ fixture, roundId }) => {
      if (!spoken) throw new Error('Expected pre-freeze transcript setup');
      // Mid-pipeline: the case map is stored and the final ballot not yet bought.
      await fixture.sql`update round_judging_jobs set case_map=${JSON.stringify(syntheticCaseMap)}::text::jsonb,
        case_map_received_at=clock_timestamp(),first_ballot_failed=true where round_id=${roundId}`;
      const now = new Date().toISOString();
      await drizzle({ client: fixture.sql }).transaction((tx) =>
        roundTranscriptPrivacyAdopter.erase(tx, spoken!.subject, { now }),
      );
      const [job] =
        await fixture.sql`select status,terminal_reason,case_map is null as cleared from round_judging_jobs where round_id=${roundId}`;
      assert({
        given:
          'an erased debater in a Round whose judging holds a case map but no ballot yet',
        should:
          'clear the stage records and end the job as discarded, as for a held response, so no claim buys them again',
        actual: { ...job },
        expected: {
          status: 'failed',
          terminal_reason: 'ballot_discarded',
          cleared: true,
        },
      });
    },
    'complete',
    async (fixture, target) => {
      spoken = await spokenRound(fixture, target.roundId, recordedAt);
    },
  );
});

test("erasure keeps a ranked Round's transcript lines and its pending judgment", () =>
  withSpokenRound(
    new Date().toISOString(),
    async ({ fixture, subject, state, roundId }) => {
      const now = new Date().toISOString();
      const database = drizzle({ client: fixture.sql });
      // A real seeded ladder format, so the ranked constraints hold.
      const [preset] = await fixture.sql`
        select format_id,version,format_version from format_presets
        where format_id='value' order by version desc limit 1`;
      const [original] = await fixture.sql`
        select format_id,format_version from rounds where id=${roundId}`;
      await fixture.sql`update rounds set competition_type='ranked',
        format_id=${preset.format_id},format_version=${preset.format_version},
        preset_version=${preset.version},ladder_id=${preset.format_id}
        where id=${roundId}`;
      try {
        const before = await state();
        await database.transaction((tx) =>
          roundTranscriptPrivacyAdopter.erase(tx, subject, { now }),
        );
        assert({
          given: 'an erased debater with lines in a ranked Round',
          should:
            'keep the lines and the judgment, since they are ranked content',
          actual: await state(),
          expected: before,
        });
      } finally {
        await fixture.sql`update rounds set competition_type='casual',
          format_id=${original.format_id},format_version=${original.format_version},
          preset_version=null,ladder_id=null where id=${roundId}`;
      }
    },
  ));
