import { createId } from '@paralleldrive/cuid2';
import { validRules } from '@daisy/db/testing';
import { foundationSettings } from '@daisy/db/reference-formats';
import { SQL } from 'bun';
import { z } from 'zod';
import { idSchema } from '@daisy/protocol';
import { betaAccessTarget } from './beta-access-target';

const command = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('create'),
      affirmative: z.string(),
      negative: z.string(),
    }),
    z.strictObject({ kind: z.literal('lapse'), username: z.string() }),
    z.strictObject({
      kind: z.literal('inspect'),
      roundId: idSchema,
      username: z.string(),
    }),
  ])
  .parse(JSON.parse(Bun.argv[2] ?? 'null'));
const client = new SQL(betaAccessTarget(process.env), { max: 1 });
try {
  const [role] = await client`select current_user as role`;
  if (role?.role !== 'daisy_e2e') throw Error('Own e2e runtime role required');
  const identity = async (username: string) => {
    const [row] =
      await client`select u.id as user_id,a.id as actor_id from users u join actors a on a.user_id=u.id where u.username=${username} and u.deleted_at is null`;
    if (!row) throw Error('Expected signed-up member');
    return { userId: String(row.user_id), actorId: String(row.actor_id) };
  };
  if (command.kind === 'lapse') {
    const account = await identity(command.username);
    await client`delete from account_entitlement_grants where user_id=${account.userId}`;
    process.stdout.write('{}');
  } else if (command.kind === 'inspect') {
    const account = await identity(command.username);
    const [facts] =
      await client`select a.work->>'kind' as kind,a.work->>'requestId' as request_id,
      jsonb_array_length(a.work->'calls') as calls,u.state->>'kind' as usage,u.source->>'kind' as source
      from round_participants p left join round_analyses a on a.round_participant_id=p.id
      left join usage_reservations u on u.actor_id=p.actor_id and u.round_id=p.round_id and u.kind='round_analysis'
      where p.round_id=${command.roundId} and p.actor_id=${account.actorId}`;
    process.stdout.write(JSON.stringify(facts));
  } else {
    const affirmative = await identity(command.affirmative);
    const negative = await identity(command.negative);
    const roundId = createId();
    const roomId = createId();
    await client.begin(async (tx) => {
      const [format] =
        await tx`select id,current_version as version from formats where id='freestyle'`;
      if (!format) throw Error('Expected own-slot reference format');
      const [clock] =
        await tx`select clock_timestamp()-interval '10 minutes' as started,clock_timestamp()-interval '5 minutes' as ended`;
      await tx`insert into rooms ${tx({ id: roomId, host_actor_id: affirmative.actorId, title: 'Requested analysis proof', topic: 'Public transit improves access', visibility: 'public', format_id: format.id, format_version: format.version, competition_type: 'casual', config: foundationSettings, execution_plan: { preRoundPrep: { enabled: false }, resolutionDraw: { enabled: false } }, rules_snapshot: validRules, status: 'started' })}`;
      await tx`insert into rounds ${tx({ id: roundId, room_id: roomId, created_by_actor_id: affirmative.actorId, resolution: 'Public transit improves access', visibility: 'public', format_id: format.id, format_version: format.version, competition_type: 'casual', room_config_snapshot: foundationSettings, rules_snapshot: validRules, status: 'completed', outcome: 'affirmative', started_at: clock.started, completed_at: clock.ended, final_segment_ended_at: clock.ended, transcript_admission_cutoff: new Date(clock.ended.getTime() + 120_000), attendance_resolution_cutoff_at: new Date(clock.ended.getTime() + 3_600_000) })}`;
      const affSeat = createId();
      await tx`insert into round_participants(id,round_id,actor_id,role,slot) values (${affSeat},${roundId},${affirmative.actorId},'affirmative',0),(${createId()},${roundId},${negative.actorId},'negative',0)`;
      const segmentId = createId();
      await tx`insert into round_segments(id,round_id,sequence,type,rules_segment_key,started_at,ended_at,duration_ms) values (${segmentId},${roundId},0,'speech','AC',${clock.started},${clock.ended},300000)`;
      await tx`insert into utterances(id,round_id,segment_id,round_participant_id,sequence,text) values (${createId()},${roundId},${segmentId},${affSeat},0,'Free transit improves access.')`;
      await tx`insert into round_transcripts(round_id,revision) values (${roundId},1)`;
      await tx`insert into round_transcript_freezes(round_id,revision,frontier,completeness) values (${roundId},1,1,'complete')`;
    });
    process.stdout.write(JSON.stringify({ roundId }));
  }
} finally {
  await client.close();
}
