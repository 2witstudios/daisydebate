import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { roundTranscriptPrivacyAdopter } from '../src/round-transcript-privacy';
import { transcriptRetention } from '../src/transcript-retention';
import type { Fixture } from './constraint-helpers';
import { validRules } from './round-fixtures';
import {
  syntheticPendingBallot as pending,
  withJudgingJob,
} from './round-judging.test-support';
setupRitewayBun();
requireTestServices(process.env);

const recordedAt = '2026-01-01T00:00:00.000Z';

/**
 * Two human debaters who each said one line in the first speech, and the AI
 * judge's validated response cached on its job, all recorded at `at`.
 */
async function spokenRound(
  fixture: Fixture,
  target: { roundId: string; judgeParticipantId: string },
  at: string,
) {
  const { roundId, judgeParticipantId } = target;
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
      await fixture.sql`select status,pending_ballot is null as cleared from round_judging_jobs where round_id=${roundId}`;
    const left: { id: string }[] =
      await fixture.sql`select id from utterances where round_id=${roundId} order by sequence`;
    return {
      job: { status: job.status, cleared: job.cleared },
      utterances: left.map((row) => row.id),
    };
  };
  return { subject, lines, state };
}

test('transcript retention removes utterances and pending judging responses 180 days old, not before', async () =>
  withJudgingJob(async ({ fixture, target }) => {
    const { lines, state } = await spokenRound(fixture, target, recordedAt);
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
          job: { status: 'queued', cleared: false },
          utterances: [lines.subject, lines.other],
        },
        due: [2, 1],
        after: { job: { status: 'failed', cleared: true }, utterances: [] },
      },
    });
  }));

test('subject erasure removes their transcript lines and every pending judgment of their Rounds', async () =>
  withJudgingJob(async ({ fixture, target }) => {
    const now = new Date().toISOString();
    const { subject, lines, state } = await spokenRound(fixture, target, now);
    const database = drizzle({ client: fixture.sql });
    const exported = await database.transaction((tx) =>
      roundTranscriptPrivacyAdopter.export(tx, subject),
    );
    await database.transaction((tx) =>
      roundTranscriptPrivacyAdopter.erase(tx, subject, { now }),
    );
    assert({
      given:
        "an erased debater's line, the other debater's line and the AI judge's cached response",
      should:
        "export only the subject's own line, then delete it, keep the other debater's, and discard the response by failing its job",
      actual: {
        exported: exported.utterances?.map((row) => row.id),
        after: await state(),
      },
      expected: {
        exported: [lines.subject],
        after: {
          job: { status: 'failed', cleared: true },
          utterances: [lines.other],
        },
      },
    });
  }));
