import { SQL } from 'bun';
import {
  stagingTranscriptConfiguration,
  transcriptProofProblems,
  type TranscriptProofStream,
} from './staging-transcript-contract';
import { transcriptProofFixture } from './staging-transcript-fixture';
import { runStagingTranscriptRound } from './staging-transcript-round';
let stage = 'target';

/** Executed on the web Fly machine via stdin; no credentials leave that machine. */
async function main() {
  const { url, secret } = stagingTranscriptConfiguration(
    process.env,
    process.argv[2],
  );
  const sql = new SQL(url, { max: 1, idleTimeout: 0 });
  try {
    stage = 'database';
    const [database] = await sql`select current_database() as name`;
    if (database?.name !== 'daisy_debate_staging')
      throw new Error('Actual staging database mismatch');
    // Serialize manual and ad hoc proofs across processes, never merely per runner.
    const [lock] = await sql`select pg_try_advisory_lock(478,1) as held`;
    if (!lock?.held)
      throw new Error('Another staging transcript proof is running');
    stage = 'capacity';
    const [capacity] =
      await sql`select count(*)::int as busy from usage_reservations u join rounds r on r.id=u.round_id where u.refunded_at is null and r.status in ('scheduled','active')`;
    if (capacity?.busy !== 0)
      throw new Error('Coordinate staging capacity before running proof');
    stage = 'fixture';
    const fixture = await transcriptProofFixture(sql, url, secret);
    try {
      stage = 'round';
      const round = await runStagingTranscriptRound(fixture.cookie);
      stage = 'evidence';
      const [freeze] =
        await sql`select completeness,frontier from round_transcript_freezes where round_id=${round.roundId}`;
      const streams: TranscriptProofStream[] = await sql`select p.role,s.state,
        (select count(*)::int from utterances u where u.segment_id=s.segment_id and u.round_participant_id=p.id and u.capture_worker_epoch is not null) as chunks,
        coalesce((select sum(extract(epoch from (o.observed_until-o.observed_from))*1000)::float8 from transcript_observations o where o.segment_id=s.segment_id and o.round_participant_id=p.id),0)::float8 as "observedMs",
        coalesce((select sum(extract(epoch from (w.credited_until-w.credited_from))*1000)::float8 from round_bot_publication_windows w where w.segment_id=s.segment_id and w.round_participant_id=p.id),0)::float8 as "publishedMs",
        exists(select 1 from agent_runs a where a.round_participant_id=p.id and a.kind='speech' and a.provider='openrouter' and a.configuration_snapshot->>'providerOutcome'='received' and a.input_tokens+a.output_tokens>0) as "realSpeech",
        exists(select 1 from agent_runs a where a.round_participant_id=p.id and a.kind='tts' and a.provider='openrouter' and a.configuration_snapshot->>'providerOutcome'='received' and a.characters>0) as "realTts",
        exists(select 1 from utterances u where u.segment_id=s.segment_id and u.round_participant_id=p.id and u.capture_worker_epoch is not null) as "realStt"
        from transcript_segments s join round_participants p on p.id=s.round_participant_id where s.round_id=${round.roundId} order by p.role`;
      const proof = {
        ...round,
        completeness: freeze?.completeness ?? null,
        frontier: freeze?.frontier ?? null,
        streams,
      };
      const problems = transcriptProofProblems(proof);
      console.log(
        JSON.stringify({
          phase: 'evidence',
          commit: process.env.GIT_COMMIT,
          ...proof,
          problems,
        }),
      );
      if (problems.length)
        throw new Error('Staging transcript proof incomplete');
      console.log(JSON.stringify({ phase: 'passed', roundId: round.roundId }));
    } finally {
      await fixture.close();
    }
  } finally {
    await sql.close();
  }
}

await main().catch(() => {
  // SQL/HTTP exceptions may contain credential-bearing inputs or transcript text.
  console.error(
    JSON.stringify({
      phase: 'failed',
      stage,
      reason:
        'Staging transcript proof refused or incomplete; inspect metadata phases and deployed service diagnostics',
    }),
  );
  process.exitCode = 1;
});
