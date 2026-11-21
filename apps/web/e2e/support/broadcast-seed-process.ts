import { systemClock } from '@daisy/clock';
import { resolveRoomConfiguration } from '@daisy/debate-engine';
import { oneOnOneSettings } from '@daisy/db/reference-formats';
import { oneOnOneFormatFixture } from '@daisy/protocol/testing';
import {
  affirmativeSide,
  emptyRuntimeCheckpointFor,
  negativeSide,
  type SideKey,
} from '@daisy/protocol';
import { mediaReleaseWording } from '@daisy/protocol/media-release';
import { createId } from '@paralleldrive/cuid2';
import { SQL, type TransactionSQL } from 'bun';
import { seatJudges } from './seat-judges';

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
  /** A signed-up member to host it, so a browser can act as the host. */
  readonly hostUsername?: string;
  /** A signed-up member seated as the affirmative, so a browser can act as a debater. */
  readonly affUsername?: string;
  readonly negUsername?: string;
  /**
   * The Room's division (its lobby), and a ranked Round's ladder. Either
   * lobby broadcasts alike (ADR 0161).
   */
  readonly division?: 'open' | 'youth';
  readonly lobbyId?: string;
  readonly tournament?: boolean;
  readonly title: string;
  readonly resolution: string;
};

type LobbyFixture =
  | {
      readonly command: 'open-lobby';
      readonly name: string;
      readonly ageRule?: 'adults' | 'anyone';
    }
  | { readonly command: 'close-lobby'; readonly lobbyId: string };

const fixtureLobby = async (sql: SQL, input: LobbyFixture) => {
  if (input.command === 'close-lobby') {
    await sql.begin(async (tx) => {
      await tx`select set_config('daisy.lobby_scope', ${input.lobbyId}, true)`;
      await tx`update lobbies set closed_at=now() where id=${input.lobbyId}`;
    });
    return;
  }
  const id = createId();
  const organizationId = createId();
  const ownerId = createId();
  await sql.begin(async (tx) => {
    await tx`insert into users (id, username, email_verified) values (${ownerId}, ${ownerId}, true)`;
    await tx`select set_config('daisy.organization_scope', ${organizationId}, true),
      set_config('daisy.lobby_scope', ${id}, true)`;
    await tx`insert into organizations (id, kind, name, handle, official, owner_user_id)
      values (${organizationId}, 'league', ${input.name}, ${organizationId}, true, ${ownerId})`;
    await tx`insert into lobbies (id, kind, name, handle, owner_organization_id, age_rule)
      values (${id}, 'standing', ${input.name}, ${id}, ${organizationId}, ${input.ageRule ?? 'adults'})`;
  });
  return { lobbyId: id };
};

const privateYouthTournament = async (
  tx: TransactionSQL,
  hostActor: string,
) => {
  const id = createId();
  await tx`select set_config('daisy.lobby_scope', ${id}, true)`;
  await tx`insert into lobbies (id, kind, owner_user_id, name, handle, age_rule)
    select ${id}, 'tournament', user_id, 'Youth test tournament', ${id}, 'under-18' from actors where id=${hostActor}`;
  await tx`insert into tournaments (lobby_id, status) values (${id}, 'draft')`;
  return { id };
};

const seedPublishedFixture = async (
  tx: TransactionSQL,
  lobbyId: string,
  roomId: string,
) => {
  const eventId = createId();
  const stageId = createId();
  const tabRoundId = createId();
  await tx`insert into events (id, lobby_id, name, format_id, format_version, entry_kind)
    values (${eventId}, ${lobbyId}, 'Youth scrimmage', 'freestyle', 1, 'person')`;
  await tx`insert into stages (id, lobby_id, event_id, kind, sequence, place, timing)
    values (${stageId}, ${lobbyId}, ${eventId}, 'preliminary', 1, 'online', 'live')`;
  await tx`insert into tab_rounds (id, lobby_id, event_id, stage_id, number)
    values (${tabRoundId}, ${lobbyId}, ${eventId}, ${stageId}, 1)`;
  // The fixture trigger records the retained Room source used by Round authorization.
  await tx`insert into fixtures (id, lobby_id, event_id, tab_round_id, kind, status, published_at, room_id)
    values (${createId()}, ${lobbyId}, ${eventId}, ${tabRoundId}, 'pairing', 'published', now(), ${roomId})`;
};

/**
 * A school whose owner is the coach and whose member is the student, the
 * coach also holding a roster grant: the coach becomes the student's linked
 * adult (ADR 0150, ADR 0155). Grants are append-only, so it is never removed.
 */
type LinkCoach = {
  readonly command: 'link-coach';
  readonly coachUsername: string;
  readonly studentUsername: string;
};

type Advance = {
  readonly command:
    | 'slate'
    | 'on-air'
    | 'interrupt'
    | 'stop'
    | 'end'
    | 'recording-ready'
    | 'recording-takedown'
    | 'release-reuse'
    | 'withdraw-reuse';
  readonly roundId: string;
};

const seat = async (
  tx: SQL,
  roundId: string,
  side: SideKey,
  name: string,
  existing = false,
) => {
  const actorId = existing
    ? (
        (
          await tx`select a.id from actors a join users u on u.id=a.user_id where u.username=${name}`
        )[0] as { id: string }
      ).id
    : createId();
  if (!existing) {
    const userId = createId();
    await tx`insert into users (id,username,email_verified) values (${userId},${name},true)`;
    await tx`insert into actors (id,kind,user_id) values (${actorId},'human',${userId})`;
  }
  await tx`insert into round_participants (id,round_id,actor_id,seat_kind,side,slot)
    values (${createId()},${roundId},${actorId},'side',${side},0)`;
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
  const roomId = createId();
  const broadcastId = createId();
  const feedKey = createId();
  const [segment] = rules.segments;
  if (!segment) throw new Error('Fixture rules have no speech');
  const roomDivision = input.division ?? 'open';
  const ageRule = roomDivision === 'youth' ? 'under-18' : 'adults';
  await sql.begin(async (tx) => {
    const hostActor = input.hostUsername
      ? (
          (
            await tx`select a.id from actors a join users u on u.id=a.user_id where u.username=${input.hostUsername}`
          )[0] as { id: string }
        ).id
      : createId();
    if (!input.hostUsername) {
      const host = createId();
      await tx`insert into users (id,username,email_verified) values (${host},${`host-${suffix}`},true)`;
      await tx`insert into actors (id,kind,user_id) values (${hostActor},'human',${host})`;
    }
    const formatColumns =
      input.mode === 'ranked'
        ? { format: 'freestyle', preset: 1 }
        : { format: 'freestyle', preset: null };
    const [lobby] = input.tournament
      ? [await privateYouthTournament(tx, hostActor)]
      : input.lobbyId
        ? await tx`select id from lobbies where id=${input.lobbyId}`
        : await tx`select l.id from lobbies l join organizations o on o.id=l.owner_organization_id
          where l.kind='standing' and o.official and l.age_rule=${ageRule} and l.closed_at is null
          order by l.created_at, l.id limit 1`;
    if (!lobby) throw new Error('The official fixture lobby is missing');
    const roomHost = input.tournament ? null : hostActor;
    const lobbyKind = input.tournament ? 'tournament' : 'standing';
    const capture = input.tournament
      ? { broadcast: null, recordingPolicy: 'off' }
      : null;
    await tx`insert into rooms (lobby_id,lobby_kind,id,host_actor_id,title,topic,visibility,format_id,format_version,preset_version,competition_type,config,execution_plan,rules_snapshot,capture,status)
      values (${lobby.id},${lobbyKind},${roomId},${roomHost},${input.title},${input.resolution},${input.visibility},${formatColumns.format},1,${formatColumns.preset},${input.mode},${{}},${{}},${rules},${capture},'started')`;
    if (input.tournament) await seedPublishedFixture(tx, lobby.id, roomId);
    let [pool] =
      input.mode === 'ranked'
        ? await tx`select ld.id as ladder_id,s.id as season_id,s.lobby_id
        from ladders ld join seasons s on s.lobby_id=ld.lobby_id and s.status='active'
        where ld.lobby_id=${lobby.id} order by ld.created_at,ld.id limit 1`
        : [];
    if (input.mode === 'ranked' && !pool) {
      const [owner] =
        await tx`select owner_organization_id from lobbies where id=${lobby.id}`;
      const [ladder] =
        await tx`select id from ladders where lobby_id=${lobby.id} order by created_at,id limit 1`;
      const seasonId = createId();
      const ladderId = ladder?.id ?? createId();
      await tx`select set_config('daisy.lobby_scope', ${lobby.id}, true),
        set_config('daisy.organization_scope', ${owner!.owner_organization_id}, true)`;
      if (!ladder)
        await tx`insert into ladders(id,lobby_id,organization_id,name)
          values (${ladderId},${lobby.id},${owner!.owner_organization_id},'Freestyle')`;
      await tx`insert into seasons(id,lobby_id,organization_id,name,status,starts_at)
        values (${seasonId},${lobby.id},${owner!.owner_organization_id},'Season 1','active',clock_timestamp())`;
      pool = { ladder_id: ladderId, season_id: seasonId, lobby_id: lobby.id };
    }
    await tx`insert into rounds (id,room_id,created_by_actor_id,resolution,competition_type,format_id,format_version,preset_version,ladder_id,season_id,rating_lobby_id,rules_snapshot,runtime_state,status,current_stage,started_at,visibility,room_config_snapshot)
      values (${roundId},${roomId},${roomHost},${input.resolution},${input.mode},${formatColumns.format},1,${formatColumns.preset},${pool?.ladder_id ?? null},${pool?.season_id ?? null},${pool?.lobby_id ?? null},${rules},${emptyRuntimeCheckpointFor(rules)},'active','live',now()-interval '5 minutes',${input.visibility},${oneOnOneSettings})`;
    const aff = await seat(
      tx as never,
      roundId,
      affirmativeSide,
      input.affUsername ?? `aff-${suffix}`,
      input.affUsername !== undefined,
    );
    await seat(
      tx as never,
      roundId,
      negativeSide,
      input.negUsername ?? `neg-${suffix}`,
      input.negUsername !== undefined,
    );
    await seatJudges(tx as never, roundId, rules.seats.judges);
    const segmentId = createId();
    await tx`insert into round_segments (id,round_id,sequence,type,rules_segment_key,started_at,duration_ms)
      values (${segmentId},${roundId},0,${segment.type},${segment.key},now()-interval '4 minutes',${segment.durationMs})`;
    const participant =
      await tx`select id from round_participants where round_id=${roundId} and actor_id=${aff}`;
    await tx`insert into utterances (id,round_id,segment_id,round_participant_id,sequence,text,complete,created_at)
      values (${createId()},${roundId},${segmentId},${participant[0].id},0,${`Caption ${suffix}`},true,now()-interval '3 minutes')`;
    // Heard from since the caption was said, or its open segment keeps it back.
    await tx`insert into broadcasts (id,round_id,feed_key,release_policy,released_through_at,control_heartbeat_at)
      values (${broadcastId},${roundId},${feedKey},${{ kind: 'delay', seconds: 60 }},now()-interval '60 seconds',now())`;
  });
  return {
    roundId,
    roomId,
    broadcastId,
    feedKey,
    aff: input.affUsername ?? `aff-${suffix}`,
    caption: `Caption ${suffix}`,
  };
};

const userIdOf = async (sql: SQL, username: string) =>
  (
    (await sql`select id from users where username=${username}`)[0] as {
      id: string;
    }
  ).id;

type DownloadFixture =
  | { readonly command: 'grant-download'; readonly username: string }
  | { readonly command: 'erase-age-evidence'; readonly username: string };

const prepareDownload = async (sql: SQL, input: DownloadFixture) => {
  const userId = await userIdOf(sql, input.username);
  if (input.command === 'grant-download') {
    await sql`insert into account_entitlement_grants (user_id, entitlement, source, starts_at, expires_at)
      values (${userId}, 'recording_download', 'subscription', now()-interval '1 day', now()+interval '1 day')`;
    return;
  }
  await sql.begin(async (tx) => {
    await tx`select set_config('daisy.subject_scope', ${userId}, true)`;
    await tx`update media_releases set withdrawn_at=clock_timestamp(), withdrawn_by='erasure'
      where user_id=${userId} and withdrawn_at is null`;
    const deleted =
      await tx`delete from account_age where user_id=${userId} returning user_id`;
    if (deleted.length !== 1)
      throw new Error('Expected to erase one age record');
  });
};

const linkCoach = async (sql: SQL, input: LinkCoach) => {
  const coach = await userIdOf(sql, input.coachUsername);
  const student = await userIdOf(sql, input.studentUsername);
  const schoolId = createId();
  await sql.begin(async (tx) => {
    const [role] = await tx`select r.id from roles r
      join role_permissions p on p.role_id = r.id
      where r.preset and p.permission = 'school.roster.manage' limit 1`;
    // The school's own rows are written under its scope, as row-level security asks.
    await tx`select set_config('daisy.organization_scope', ${schoolId}, true)`;
    await tx`insert into organizations(id,kind,name,handle,owner_user_id)
      values(${schoolId},'school','Riverside High',${`riverside-${schoolId.slice(0, 10)}`},${coach})`;
    for (const userId of [coach, student])
      await tx`insert into memberships(organization_id,user_id,status,joined_at)
        values(${schoolId},${userId},'active',now())`;
    await tx`insert into grants(id,role_id,user_id,scope_kind,organization_id,granted_at)
      values(${createId()},${role.id},${coach},'organization',${schoolId},now())`;
  });
  return { schoolId };
};

const advance = async (sql: SQL, input: Advance) => {
  const { roundId } = input;
  switch (input.command) {
    case 'on-air':
      await sql`update broadcasts set released_through_at=now()-interval '60 seconds' where round_id=${roundId}`;
      return;
    case 'slate':
      // A real slate: a speech has been released and ended, and the next began after
      // the watermark. Ending the only speech instead would have the server's own sweep
      // open the next one, as it should.
      await sql`update round_segments set sequence=sequence+1, started_at=now() where round_id=${roundId}`;
      await sql`insert into round_segments (id,round_id,sequence,type,rules_segment_key,started_at,ended_at,duration_ms)
        select ${createId()},round_id,0,type,'released-speech',now()-interval '10 minutes',now()-interval '5 minutes',duration_ms
        from round_segments where round_id=${roundId} and sequence=1`;
      return;
    case 'interrupt':
      await sql`update broadcasts set released_through_at=now()-interval '10 minutes' where round_id=${roundId}`;
      return;
    case 'stop':
      await sql`update broadcasts set stopped_at=now(),stop_reason='policy_violation',media_withheld=true where round_id=${roundId}`;
      return;
    case 'end':
      await sql`update rounds set status='completed',current_stage=null,winning_side=${affirmativeSide},completed_at=now()-interval '3 minutes' where id=${roundId}`;
      await sql`update round_segments set ended_at=coalesce(ended_at,now()-interval '3 minutes') where round_id=${roundId}`;
      await sql`update broadcasts set final_media_end_at=now()-interval '3 minutes',released_through_at=now()-interval '1 minute',stream_ended_at=now(),completed_at=now() where round_id=${roundId}`;
      await sql`insert into recordings (id,round_id,recording_class,eligibility,status,lifecycle)
        select ${createId()},${roundId},competition_type,
          case competition_type when 'ranked' then ${{ kind: 'ranked' }}::jsonb else jsonb_build_object('kind','host_opt_in','hostActorId',created_by_actor_id) end,
          'requested',${{ status: 'requested' }}
        from rounds where id=${roundId}`;
      return;
    case 'recording-ready': {
      const at = systemClock.now();
      const [row] =
        await sql`select id from recordings where round_id=${roundId}`;
      const prefix = `recordings/${row.id}/`;
      const [speaker] =
        await sql`select id from round_participants where round_id=${roundId} and seat_kind='side' and side=${affirmativeSide}`;
      await sql`update recordings set status='ready',lifecycle=${{
        status: 'ready',
        capture: {
          source: { kind: 'own_capture' },
          startedAt: at,
          endedAt: at,
          attempts: [{ attempt: 1, egressId: 'EG', startedAt: at }],
        },
        media: {
          capturedFrom: at,
          playlistKey: `${prefix}hls/master.m3u8`,
          downloadKey: `${prefix}video.mp4`,
          durationMs: 8000,
          byteSize: 10,
          verifiedAt: at,
          gaps: [{ startMs: 4000, endMs: 6000, reason: 'capture_restart' }],
          speeches: [
            { roundParticipantId: speaker.id, startMs: 2000, endMs: 4000 },
          ],
        },
      }} where round_id=${roundId}`;
      return row.id as string;
    }
    case 'release-reuse': {
      const debaters = await sql<{ user_id: string }[]>`select a.user_id
        from round_participants p join actors a on a.id = p.actor_id
        where p.round_id = ${roundId} and p.seat_kind = 'side'`;
      if (debaters.length !== 2)
        throw new Error('Expected two fixture debaters');
      await sql.begin(async (tx) => {
        for (const { user_id } of debaters)
          await tx`insert into media_releases
            (id, user_id, scope, source, signer_name, signer_relation, signer_email, wording_version, signed_at)
            values (${createId()}, ${user_id}, 'publish', 'parent', 'Fixture guardian', 'parent',
              'fixture@example.test', ${mediaReleaseWording.version}, clock_timestamp())`;
      });
      return;
    }
    case 'withdraw-reuse':
      await sql`update media_releases m
        set withdrawn_at = clock_timestamp(), withdrawn_by = 'parent'
        from round_participants p join actors a on a.id = p.actor_id
        where p.round_id = ${roundId} and p.seat_kind = 'side'
          and p.side = ${affirmativeSide} and m.user_id = a.user_id and m.scope = 'publish'`;
      return;
    case 'recording-takedown': {
      const at = systemClock.now();
      await sql`update recordings set status='taken_down',lifecycle=jsonb_build_object('status','taken_down','takenDownAt',${at}::text,'held',lifecycle) where round_id=${roundId}`;
      return undefined;
    }
  }
};

if (import.meta.main) {
  const input = JSON.parse(Bun.argv[2] ?? '{}') as
    Create | LinkCoach | Advance | LobbyFixture | DownloadFixture;
  const sql = new SQL(process.env.E2E_DATABASE_URL ?? '', { max: 1 });
  try {
    const result =
      input.command === 'create'
        ? await create(sql, input)
        : input.command === 'link-coach'
          ? await linkCoach(sql, input)
          : input.command === 'open-lobby' || input.command === 'close-lobby'
            ? await fixtureLobby(sql, input)
            : input.command === 'grant-download' ||
                input.command === 'erase-age-evidence'
              ? await prepareDownload(sql, input)
              : await advance(sql, input);
    process.stdout.write(JSON.stringify(result ?? { ok: true }));
  } finally {
    await sql.close();
  }
}
