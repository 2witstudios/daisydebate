import { afterAll } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { SQL } from 'bun';
import { Fixture } from './constraint-helpers';
import { validConfig } from './round-fixtures';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

const migration = '20261116175848_freestyle_only_ranked';
const scratch = scratchDatabase(url, 'freestyleonly');

afterAll(() => scratch.drop());

test(
  'the migration deletes every Policy and Value row and keeps Freestyle intact (ADR 0142)',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < migration);
    // The scratch database is dropped whole, so nothing here purges rows.
    const client = new SQL(scratch.url);
    const f = new Fixture(client);
    try {
      const host = await f.actor();
      const [publication] = await f.sql`
        select id from published_resolutions where kind = 'value' and retired_at is null`;
      const presetOf = async (formatId: string) => {
        const [row] = await f.sql`
          select version from format_presets
           where format_id = ${formatId} and superseded_at is null`;
        return (row as { version: number }).version;
      };
      const seasonId = createId();
      await f.insert('seasons', {
        id: seasonId,
        name: 'Beta Season 1',
        starts_at: new Date('2026-10-01'),
        status: 'active',
      });
      const rankedRound = async (ladder: string) => {
        const roundId = await f.round({
          competition_type: 'ranked',
          ladder_id: ladder,
          format_id: ladder,
          preset_version: await presetOf(ladder),
        });
        const actor = await f.participant(roundId, 'affirmative');
        await f.insert(
          'ratings',
          {
            actor_id: actor,
            ladder,
            season_id: seasonId,
            rating: 1500,
            deviation: 350,
            volatility: 0.06,
          },
          'actor_id',
        );
        await f.insert('rating_changes', {
          id: createId(),
          round_id: roundId,
          actor_id: actor,
          format_id: ladder,
          ladder,
          season_id: seasonId,
          rating_before: 1500,
          rating_after: 1500,
          deviation_before: 350,
          deviation_after: 300,
          volatility_before: 0.06,
          volatility_after: 0.06,
          calculation_version: 'glicko2-v1',
          occurred_at: new Date('2026-10-02'),
        });
        return { roundId, actor };
      };
      const policy = await rankedRound('policy');
      const freestyle = await rankedRound('freestyle');

      // A casual Value Room pinned to its publication, with a recorded Round.
      const valueRoom = await f.room(host, 'value', {
        published_resolution_id: (publication as { id: string }).id,
      });
      const valueRound = await f.round({
        room_id: valueRoom,
        room_config_snapshot: validConfig,
        visibility: 'public',
        format_id: 'value',
        published_resolution_id: (publication as { id: string }).id,
      });
      const recordingId = createId();
      await f.sql`insert into recordings (id,round_id,recording_class,eligibility,status,lifecycle)
        values (${recordingId},${valueRound},'casual',${{ kind: 'casual_opted_in', hostActorId: host }},'ready',${{ status: 'ready' }})`;
      // A Custom Room that started from Value keeps its rules, not the basis.
      const customFormat = await f.format();
      const customRoom = await f.room(host, customFormat, {
        basis_format_id: 'value',
        basis_preset_version: await presetOf('value'),
      });
      const freestyleRoom = await f.room(host, 'freestyle');
      const challenge = async (format: string, challenged: string) => {
        const id = createId();
        await f.insert('challenges', {
          id,
          challenger_actor_id: host,
          challenged_actor_id: challenged,
          mode: 'casual',
          format_id: format,
          created_at: new Date('2026-10-02'),
          expires_at: new Date('2026-10-03'),
        });
        return id;
      };
      const policyChallenge = await challenge('policy', policy.actor);
      const freestyleChallenge = await challenge('freestyle', freestyle.actor);

      // Chat files in a deleted Room's and a deleted Round's channels.
      const channel = async (kind: string, column: string, id: string) => {
        const channelId = createId();
        await f.insert('messaging_channels', {
          id: channelId,
          kind,
          policy_key:
            kind === 'room_community' ? 'room.community' : 'round.floor',
          policy_revision: 1,
          lifecycle: 'active',
          [column]: id,
        });
        const objectKey = `freestyle-only/${createId()}`;
        await f.sql.unsafe(
          "insert into messaging_files(id,channel_id,owner_actor_id,request_id,object_key,filename,mime,reserved_bytes,generation,authority_revision,lifecycle,created_at,expires_at) values($1,$2,$3,$4,$5,'notes.pdf','application/pdf',20,1,1,'reserved',now(),now() + interval '1 hour')",
          [createId(), channelId, host, createId(), objectKey],
        );
        return objectKey;
      };
      const chatObjects = [
        await channel('room_community', 'room_id', valueRoom),
        await channel('round_floor', 'round_id', policy.roundId),
      ];
      const counts = () => f.sql`
        select (select count(*)::int from rounds) as rounds,
               (select count(*)::int from recordings) as recordings,
               (select count(*)::int from formats where id in ('policy','value')) as formats`;
      const before = await counts();
      const refusal = await scratch
        .migrate((folder) => folder <= migration)
        .then(
          () => 'migrated',
          (error: unknown) =>
            String(error).includes(
              'requires every Policy and Value recording removed, broadcast feed withdrawn and media session ended first',
            ),
        );
      assert({
        given:
          'a Value Round whose recording still holds media (not yet removed by the deletion sweep)',
        should:
          'refuse the whole migration and change nothing, so no stored media is orphaned',
        actual: { refused: refusal, unchanged: [...(await counts())] },
        expected: { refused: true, unchanged: [...before] },
      });
      // The operator removes it through the normal pipeline; the sweep marks it removed.
      await f.sql`update recordings set status = 'removed',
        lifecycle = ${{ status: 'removed', cause: 'participant_request', requestedAt: '2026-10-02T00:00:00.000Z', removedAt: '2026-10-02T00:10:00.000Z' }}
        where id = ${recordingId}`;
      await scratch.migrate((folder) => folder <= migration);

      const ids = (rows: readonly { id: string }[]) => rows.map((r) => r.id);
      const rounds = await f.sql`
        select id from rounds
         where id in ${f.sql([policy.roundId, freestyle.roundId, valueRound])}`;
      const rooms = await f.sql`
        select id, basis_format_id from rooms
         where id in ${f.sql([valueRoom, customRoom, freestyleRoom])}
         order by id = ${customRoom} desc`;
      const ratings = await f.sql`
        select ladder from ratings where season_id = ${seasonId}`;
      const changes = await f.sql`
        select ladder from rating_changes where season_id = ${seasonId}`;
      const challenges = await f.sql`
        select id from challenges
         where id in ${f.sql([policyChallenge, freestyleChallenge])}`;
      const formats = await f.sql`
        select id from formats where catalog_role = 'standard'`;
      const leftovers = await f.sql`
        select
          (select count(*)::int from formats where id in ('policy','value')) as formats,
          (select count(*)::int from format_presets where format_id in ('policy','value')) as presets,
          (select count(*)::int from format_revisions where format_id in ('policy','value')) as revisions,
          (select count(*)::int from recordings where round_id = ${valueRound}) as recordings,
          to_regclass('public.published_resolutions') is null as publications_dropped,
          to_regclass('public.rating_visibility') is null as visibility_dropped`;
      const intents = await f.sql`
        select object_key, charged_bytes::int as charged_bytes from messaging_file_deletion_intents
         where object_key in ${f.sql(chatObjects)} order by object_key`;
      const files = await f.sql`
        select count(*)::int as files from messaging_files
         where object_key in ${f.sql(chatObjects)}`;
      const refused = await f.sql`
        select pg_get_constraintdef(oid) as definition from pg_constraint
         where conname = 'ratings_ladder_check'`;
      assert({
        given:
          'ranked Policy and Freestyle Rounds with standings, a recorded Value Room and Round pinned to a publication, chat files in a Value Room and a Policy Round, a Custom Room based on Value, and Policy and Freestyle challenges, then the migration',
        should:
          'delete every Policy and Value row and the publication and visibility tables, turn their chat files into deletion intents, unset the Custom basis, and keep every Freestyle row',
        actual: {
          rounds: ids(rounds as unknown as { id: string }[]),
          rooms: [...rooms],
          ratings: [...ratings],
          changes: [...changes],
          challenges: ids(challenges as unknown as { id: string }[]),
          standards: [...formats],
          leftovers: [...leftovers],
          freestyleOnly: (
            refused[0] as { definition: string }
          ).definition.includes("'policy'"),
          chat: { intents: [...intents], files: [...files] },
        },
        expected: {
          rounds: [freestyle.roundId],
          rooms: [
            { id: customRoom, basis_format_id: null },
            { id: freestyleRoom, basis_format_id: null },
          ],
          ratings: [{ ladder: 'freestyle' }],
          changes: [{ ladder: 'freestyle' }],
          challenges: [freestyleChallenge],
          standards: [{ id: 'freestyle' }],
          leftovers: [
            {
              formats: 0,
              presets: 0,
              revisions: 0,
              recordings: 0,
              publications_dropped: true,
              visibility_dropped: true,
            },
          ],
          freestyleOnly: false,
          chat: {
            intents: [...chatObjects]
              .sort()
              .map((object_key) => ({ object_key, charged_bytes: 20 })),
            files: [{ files: 0 }],
          },
        },
      });
    } finally {
      await client.close();
    }
  },
  ddlTimeoutMs * 4,
);
