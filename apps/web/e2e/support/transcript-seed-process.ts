import { resolve } from 'node:path';
import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { idSchema } from '@daisy/protocol';
import { admitLaunchCheckout } from './room-launch-admission';
import { requireLaunchSlot } from './room-launch-slot';

/**
 * Commits synthetic transcript lines to the admitted slot's own e2e database,
 * as capture's append would: the line, the stream's count and the revision.
 * Text here is fixture wording, never a person's speech.
 */
if (import.meta.main) {
  const checkout = resolve(import.meta.dir, '../../../..');
  const slot = requireLaunchSlot(checkout, process.env);
  await admitLaunchCheckout(checkout, slot.database);
  const roundId = idSchema.parse(Bun.argv[2]);
  const from = Number(Bun.argv[3]);
  const count = Number(Bun.argv[4]);
  if (![from, count].every(Number.isSafeInteger) || count < 1 || count > 512)
    throw new Error('Explicit bounded transcript fixture required');
  const sql = new SQL(process.env.E2E_DATABASE_URL!, { max: 1 });
  try {
    await sql.begin(async (tx) => {
      const [line] = await tx`
        select s.id segment_id, p.id participant_id
        from round_segments s
        join round_participants p on p.round_id=s.round_id and p.role='affirmative'
        where s.round_id=${roundId}
        order by s.sequence limit 1`;
      if (!line) throw new Error('No played segment to transcribe');
      await tx`
        insert into transcript_segments(round_id,segment_id,round_participant_id)
        values(${roundId},${line.segment_id},${line.participant_id})
        on conflict do nothing`;
      for (let at = from; at < from + count; at++) {
        await tx`
          insert into utterances(id,round_id,segment_id,round_participant_id,sequence,text,complete,capture_start_offset_ms,created_at)
          values(${createId()},${roundId},${line.segment_id},${line.participant_id},${at},${`Fixture line ${at}.`},true,${355 + at * 1000},now())`;
        await tx`
          insert into round_transcripts(round_id,revision) values(${roundId},1)
          on conflict (round_id) do update set revision=round_transcripts.revision+1`;
      }
    });
    process.stdout.write('{"ok":true}');
  } finally {
    await sql.close();
  }
}
