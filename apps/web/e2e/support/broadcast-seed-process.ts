import { systemClock } from '@daisy/clock';
import { resolveRoomConfiguration } from '@daisy/debate-engine';
import { oneOnOneSettings } from '@daisy/db/reference-formats';
import { oneOnOneFormatFixture } from '@daisy/protocol/testing';
import { createId } from '@paralleldrive/cuid2';
import { SQL } from 'bun';

/**
 * Commits a live Round's public facts to this suite's own e2e database, as the
 * Broadcast control plane and capture would: the Round, its seats, a speech, a
 * caption and a Broadcast on its delay. It owns no rule; the page reads these
 * rows through the one release rule. Every value is fixture wording.
 */
type Create = {
  readonly command: 'create';
  readonly mode: 'ranked' | 'casual';
  readonly visibility: 'public' | 'unlisted' | 'private';
  readonly title: string;
  readonly resolution: string;
};

type Advance = {
  readonly command:
    'slate' | 'on-air' | 'interrupt' | 'stop' | 'end' | 'recording-ready';
  readonly roundId: string;
};

const seat = async (tx: SQL, roundId: string, role: string, name: string) => {
  const userId = createId();
  const actorId = createId();
  await tx`insert into users (id,username,email_verified) values (${userId},${name},true)`;
  await tx`insert into actors (id,kind,user_id) values (${actorId},'human',${userId})`;
  await tx`insert into round_participants (id,round_id,actor_id,role,slot)
    values (${createId()},${roundId},${actorId},${role},0)`;
  return actorId;
};

const create = async (sql: SQL, input: Create) => {
  const resolved = resolveRoomConfiguration(
    oneOnOneFormatFixture,
    oneOnOneSettings,
  );
  if (!resolved.ok) throw new Error(resolved.refusal.message);
  const rules = resolved.rules;
  const suffix = createId().slice(0, 10);
  const roundId = createId();
  const broadcastId = createId();
  const [segment] = rules.segments;
  if (!segment) throw new Error('Fixture rules have no speech');
  await sql.begin(async (tx) => {
    const host = createId();
    const hostActor = createId();
    await tx`insert into users (id,username,email_verified) values (${host},${`host-${suffix}`},true)`;
    await tx`insert into actors (id,kind,user_id) values (${hostActor},'human',${host})`;
    const formatColumns =
      input.mode === 'ranked'
        ? { format: 'freestyle', preset: 1, ladder: 'freestyle' }
        : { format: 'freestyle', preset: null, ladder: null };
    const roomId = createId();
    await tx`insert into rooms (id,host_actor_id,title,topic,visibility,format_id,format_version,preset_version,competition_type,config,execution_plan,rules_snapshot,status)
      values (${roomId},${hostActor},${input.title},${input.resolution},${input.visibility},${formatColumns.format},1,${formatColumns.preset},${input.mode},${{}},${{}},${rules},'started')`;
    await tx`insert into rounds (id,room_id,created_by_actor_id,resolution,competition_type,format_id,format_version,preset_version,ladder_id,rules_snapshot,status,current_stage,started_at,visibility,room_config_snapshot)
      values (${roundId},${roomId},${hostActor},${input.resolution},${input.mode},${formatColumns.format},1,${formatColumns.preset},${formatColumns.ladder},${rules},'active','live',now()-interval '5 minutes',${input.visibility},${{}})`;
    const aff = await seat(
      tx as never,
      roundId,
      'affirmative',
      `aff-${suffix}`,
    );
    await seat(tx as never, roundId, 'negative', `neg-${suffix}`);
    const segmentId = createId();
    await tx`insert into round_segments (id,round_id,sequence,type,rules_segment_key,started_at,duration_ms)
      values (${segmentId},${roundId},0,${segment.type},${segment.key},now()-interval '4 minutes',${segment.durationMs})`;
    const participant =
      await tx`select id from round_participants where round_id=${roundId} and actor_id=${aff}`;
    await tx`insert into utterances (id,round_id,segment_id,round_participant_id,sequence,text,complete,created_at)
      values (${createId()},${roundId},${segmentId},${participant[0].id},0,${`Caption ${suffix}`},true,now()-interval '3 minutes')`;
    await tx`insert into broadcasts (id,round_id,release_policy,released_through_at)
      values (${broadcastId},${roundId},${{ kind: 'delay', seconds: 60 }},now()-interval '60 seconds')`;
  });
  return {
    roundId,
    broadcastId,
    aff: `aff-${suffix}`,
    caption: `Caption ${suffix}`,
  };
};

const advance = async (sql: SQL, input: Advance) => {
  const { roundId } = input;
  switch (input.command) {
    case 'on-air':
      await sql`update broadcasts set released_through_at=now()-interval '60 seconds' where round_id=${roundId}`;
      return;
    case 'slate':
      // Its speech began after the watermark. Ending it instead would have the
      // server's own sweep open the next speech, as it should.
      await sql`update round_segments set started_at=now() where round_id=${roundId}`;
      return;
    case 'interrupt':
      await sql`update broadcasts set released_through_at=now()-interval '10 minutes' where round_id=${roundId}`;
      return;
    case 'stop':
      await sql`update broadcasts set stopped_at=now(),stop_reason='moderation' where round_id=${roundId}`;
      return;
    case 'end':
      await sql`update rounds set status='completed',current_stage=null,outcome='affirmative',completed_at=now()-interval '3 minutes' where id=${roundId}`;
      await sql`update round_segments set ended_at=coalesce(ended_at,now()-interval '3 minutes') where round_id=${roundId}`;
      await sql`update broadcasts set final_media_end_at=now()-interval '3 minutes',released_through_at=now()-interval '1 minute',completed_at=now() where round_id=${roundId}`;
      await sql`insert into recordings (id,round_id,recording_class,eligibility,status,lifecycle)
        select ${createId()},${roundId},competition_type,
          case competition_type when 'ranked' then ${{ kind: 'ranked' }}::jsonb else jsonb_build_object('kind','host_opt_in','hostActorId',created_by_actor_id) end,
          'requested',${{ status: 'requested' }}
        from rounds where id=${roundId}`;
      return;
    case 'recording-ready': {
      const at = systemClock.now();
      const prefix = `recordings/${createId()}/`;
      await sql`update recordings set status='ready',lifecycle=${{
        status: 'ready',
        capture: {
          egressId: 'EG',
          startedAt: at,
          endedAt: at,
          sourceKey: `${prefix}source.mp4`,
        },
        media: {
          playlistKey: `${prefix}hls/master.m3u8`,
          downloadKey: `${prefix}video.mp4`,
          durationMs: 60_000,
          byteSize: 10,
          verifiedAt: at,
          gaps: [],
          speeches: [],
        },
      }} where round_id=${roundId}`;
      return;
    }
  }
};

if (import.meta.main) {
  const input = JSON.parse(Bun.argv[2] ?? '{}') as Create | Advance;
  const sql = new SQL(process.env.E2E_DATABASE_URL ?? '', { max: 1 });
  try {
    const result =
      input.command === 'create'
        ? await create(sql, input)
        : await advance(sql, input);
    process.stdout.write(JSON.stringify(result ?? { ok: true }));
  } finally {
    await sql.close();
  }
}
