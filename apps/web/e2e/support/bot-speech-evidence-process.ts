import { idSchema } from '@daisy/protocol';
import { readLaunchDatabase } from './launch-evidence-database';

/** Provider accounting of every bot seat's runs; counts and outcomes only, never text. */
if (import.meta.main) {
  try {
    const roundId = idSchema.parse(Bun.argv[2]);
    const runs = await readLaunchDatabase(
      (
        tx,
      ) => tx`select p.role,a.kind,a.configuration_snapshot->>'providerOutcome' as outcome,
        a.requests,a.input_tokens as "inputTokens",a.output_tokens as "outputTokens",a.characters
        from agent_runs a join round_participants p on p.id=a.round_participant_id
        where p.round_id=${roundId} order by p.role,a.kind,a.started_at`,
    );
    process.stdout.write(JSON.stringify(runs));
  } catch {
    process.stderr.write(
      `${JSON.stringify({ event: 'bot.speech.evidence', outcome: 'refused' })}\n`,
    );
    process.exitCode = 1;
  }
}
