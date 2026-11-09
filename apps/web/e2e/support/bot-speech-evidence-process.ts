import { idSchema } from '@daisy/protocol';
import { readLaunchDatabase } from './launch-evidence-database';

/**
 * Provider accounting of every bot seat's runs, and each seat's authored lines
 * (ADR 0122); counts, lengths and states only, never text.
 */
if (import.meta.main) {
  try {
    const roundId = idSchema.parse(Bun.argv[2]);
    const runs = await readLaunchDatabase(
      (tx) => tx`select p.role,a.kind,
        case when a.kind='judging'
          then (case when t.answered_at is not null then 'received' end)
          else a.configuration_snapshot->>'providerOutcome' end as outcome,
        a.requests,a.input_tokens as "inputTokens",a.output_tokens as "outputTokens",a.characters
        from agent_runs a join round_participants p on p.id=a.round_participant_id
        left join round_judging_attempts t on t.agent_run_id=a.id
        where p.round_id=${roundId} order by p.role,a.kind,a.started_at`,
    );
    const lines = await readLaunchDatabase(
      (
        tx,
      ) => tx`select p.role,char_length(u.text) as characters,u.complete,u.interrupted
        from utterances u join round_participants p on p.id=u.round_participant_id
        join round_segments s on s.id=u.segment_id
        where u.round_id=${roundId} and u.bot_phrase_id is not null
        order by s.sequence,u.sequence`,
    );
    process.stdout.write(JSON.stringify({ runs, lines }));
  } catch {
    process.stderr.write(
      `${JSON.stringify({ event: 'bot.speech.evidence', outcome: 'refused' })}\n`,
    );
    process.exitCode = 1;
  }
}
