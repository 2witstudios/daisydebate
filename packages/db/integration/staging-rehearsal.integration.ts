import { afterAll } from 'bun:test';
import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, test } from 'riteway/bun';
import {
  recordingLifecycleSchema,
  roundRulesSchema,
  type RoundRules,
} from '@daisy/protocol';
import { resolveRoomConfiguration } from '@daisy/debate-engine';
import {
  foundationSettings,
  referenceFormats,
  referencePresets,
} from '../src/reference-formats';
import { catalogFormats } from '../src/catalog-formats';
import { Fixture } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';
import { integrationSuite } from './suite.test-support';

const { databaseUrl } = integrationSuite();
const scratch = scratchDatabase(databaseUrl, 'stagingrehearsal');
afterAll(() => scratch.drop());

// The exact delta from main at db76b101c to parent 51f3d4861. All other
// folders are retained, including main migrations newer than the Tab folders.
const parentFolders = new Set([
  '20261114051015_tab_schema',
  '20261114051016_tab_schema_checks_validated',
  '20261114151541_tab_seats',
  '20261114152055_tab_seats_checks_validated',
  '20261114172122_tab_casual_templates',
]);

const oldRules = ({
  version: _version,
  sides: _sides,
  outcome: _outcome,
  seats: { sides, judges },
  segments,
  ...rest
}: RoundRules) => ({
  ...rest,
  version: 2,
  seats: {
    affirmative: sides['affirmative'],
    negative: sides['negative'],
    judge: judges,
  },
  segments: segments.map(({ speak, ...segment }) => {
    const seat = speak.rights === 'one' ? speak.seat : speak.lead;
    if (seat?.kind !== 'side')
      throw new Error('Expected a two-sided legacy format');
    return { ...segment, side: seat.side, slot: seat.slot };
  }),
});

/** Exact row snapshots, not counts: catches changed IDs, text, timing and references. */
const snapshot = async (sql: SQL, tables: readonly string[]) =>
  Object.fromEntries(
    await Promise.all(
      tables.map(async (table) => [
        table,
        (
          await sql.unsafe(
            `select coalesce(jsonb_agg(row order by row::text), '[]'::jsonb) as rows from (select to_jsonb(t) as row from ${table} t) s`,
          )
        )[0]!.rows,
      ]),
    ),
  );

test(
  'main data survives every parent migration with the same competitive and social meaning',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => !parentFolders.has(folder));
    const sql = new SQL(scratch.url, { max: 1 });
    const f = new Fixture(sql);
    try {
      const host = await f.actor();
      const at = new Date('2026-11-01T10:00:00Z');
      const catalog = [
        ...referenceFormats.map(({ id, revisions }) => ({
          id,
          version: revisions.length,
          definition: revisions.at(-1)!,
          config:
            referencePresets.filter((p) => p.formatId === id).at(-1)?.config ??
            foundationSettings,
        })),
        ...catalogFormats
          .filter(({ id }) => !id.startsWith('casual-'))
          .map(({ id, definition, preset }) => ({
            id,
            version: 1,
            definition,
            config: preset,
          })),
      ];
      // Only formats actually present on main; casual templates belong to Tab.
      const existing = new Set(
        (await sql`select id from formats`).map((r: { id: string }) => r.id),
      );
      const expectedRules = new Map<string, RoundRules>();
      const roundIds: string[] = [];
      for (const format of catalog.filter(({ id }) => existing.has(id))) {
        const compiled = resolveRoomConfiguration(
          format.definition,
          format.config,
        );
        if (!compiled.ok) throw new Error(`Cannot compile ${format.id}`);
        const rules = oldRules(compiled.rules);
        const room = await f.room(host, format.id, {
          format_version: format.version,
          config: format.config,
          rules_snapshot: rules,
          capture: { broadcast: null, recording: true },
        });
        expectedRules.set(room, compiled.rules);
        for (const role of ['affirmative', 'negative', 'judge'])
          await f.insert('room_participants', {
            id: createId(),
            room_id: room,
            actor_id: await f.actor(),
            role,
            slot: 0,
          });
        for (const status of ['opening', 'active', 'completed', 'abandoned']) {
          const round = await f.round({
            format_id: format.id,
            format_version: format.version,
            rules_snapshot: rules,
            status,
            current_stage: status === 'active' ? 'live' : null,
            outcome: status === 'completed' ? 'affirmative' : null,
            started_at:
              status === 'active' || status === 'completed' ? at : null,
            completed_at:
              status === 'completed' || status === 'abandoned' ? at : null,
            capture: { broadcast: null, recording: true },
          });
          roundIds.push(round);
          expectedRules.set(round, compiled.rules);
          for (const role of ['affirmative', 'negative', 'judge'])
            await f.participant(round, role, 0, await f.actor());
        }
      }
      // Rated history on every existing ladder, with human and bot seats and
      // its actual ledger FK chain. The format corpus above also keeps every
      // lifecycle, including winnerless abandoned and unstarted Rounds.
      const [bot] =
        await sql`select id from actors where kind = 'bot' order by id limit 1`;
      if (!bot) throw new Error('Main reference seed must include a bot actor');
      const season = createId();
      await f.insert('seasons', {
        id: season,
        name: 'Retained season',
        starts_at: at,
        status: 'active',
      });
      for (const ladder of ['freestyle', 'policy', 'value']) {
        const format = catalog.find(({ id }) => id === ladder)!;
        const compiled = resolveRoomConfiguration(
          format.definition,
          format.config,
        );
        if (!compiled.ok) throw new Error(`Cannot compile ranked ${ladder}`);
        const [preset] =
          await sql`select version from format_presets where format_id = ${ladder} and format_version = ${format.version} order by version desc limit 1`;
        const rated = await f.round({
          format_id: ladder,
          format_version: format.version,
          competition_type: 'ranked',
          ladder_id: ladder,
          preset_version: preset!.version,
          rules_snapshot: oldRules(compiled.rules),
          status: 'completed',
          current_stage: null,
          outcome: 'negative',
          started_at: at,
          completed_at: at,
        });
        expectedRules.set(rated, compiled.rules);
        roundIds.push(rated);
        await f.participant(rated, 'affirmative', 0, host);
        await f.participant(rated, 'negative', 0, bot.id);
        await f.insert(
          'ratings',
          {
            actor_id: host,
            season_id: season,
            ladder,
            rating: 1490,
            deviation: 110,
            volatility: 0.06,
          },
          'actor_id',
        );
        await f.insert('rating_changes', {
          id: createId(),
          round_id: rated,
          actor_id: host,
          format_id: ladder,
          ladder,
          season_id: season,
          rating_before: 1500,
          rating_after: 1490,
          deviation_before: 120,
          deviation_after: 110,
          volatility_before: 0.06,
          volatility_after: 0.06,
          calculation_version: 'glicko2-v1',
          occurred_at: at,
        });
      }
      const round = roundIds[0]!;
      await f.insert('recordings', {
        id: createId(),
        round_id: round,
        recording_class: 'casual',
        eligibility: { kind: 'host_opt_in', hostActorId: host },
        status: 'requested',
        lifecycle: { status: 'requested' },
      });
      const recording = createId();
      const instant = at.toISOString();
      const ready = recordingLifecycleSchema.parse({
        status: 'ready',
        capture: {
          source: { kind: 'own_capture' },
          startedAt: instant,
          endedAt: instant,
          attempts: [
            { attempt: 1, egressId: 'retained-egress', startedAt: instant },
          ],
        },
        media: {
          capturedFrom: instant,
          playlistKey: `recordings/${recording}/index.m3u8`,
          downloadKey: `recordings/${recording}/video.mp4`,
          durationMs: 60000,
          byteSize: 100000,
          verifiedAt: instant,
          gaps: [],
          speeches: [],
        },
      });
      await f.insert('recordings', {
        id: recording,
        round_id: roundIds[2]!,
        recording_class: 'casual',
        eligibility: { kind: 'host_opt_in', hostActorId: host },
        status: 'ready',
        lifecycle: ready,
      });
      const channel = createId();
      await f.insert('messaging_channels', {
        id: channel,
        kind: 'round_floor',
        round_id: round,
        policy_key: 'round.floor',
        policy_revision: 1,
        lifecycle: 'active',
      });
      await f.insert('messaging_messages', {
        id: createId(),
        channel_id: channel,
        author_actor_id: host,
        sequence: 1,
        change_version: 1,
        text: 'A retained chat message.',
        created_at: at,
      });
      const user = await f.user();
      await f.insert(
        'account_beta_access',
        {
          user_id: user,
          state: 'approved',
          requested_at: at,
          decided_at: at,
          provenance: 'signup',
        },
        'user_id',
      );
      await sql`insert into room_active_memberships (actor_id, room_id)
        select actor_id, room_id from room_participants order by id limit 1`;
      const activeSeatsBefore =
        await sql`select * from room_active_memberships order by actor_id`;
      const rewritten = [
        'formats',
        'format_revisions',
        'format_presets',
        'rooms',
        'rounds',
        'round_participants',
        'room_participants',
        'seasons',
        'room_active_memberships',
      ];
      const unchanged = (
        await sql`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') order by relname`
      )
        .map((row: { relname: string }) => row.relname)
        .filter((name: string) => !rewritten.includes(name));
      const roomSeatsBefore =
        await sql`select id, role, slot from room_participants order by id`;
      const seasonsBefore =
        await sql`select to_jsonb(s) as row from seasons s order by id`;
      const before = await snapshot(sql, unchanged);
      const roomsBefore =
        await sql`select to_jsonb(r) - array['rules_snapshot', 'capture'] as row from rooms r order by id`;
      const roundFieldsBefore =
        await sql`select to_jsonb(r) - array['rules_snapshot', 'capture', 'outcome'] as row from rounds r order by id`;
      const roomParticipantsBefore =
        await sql`select to_jsonb(p) - 'role' as row from room_participants p order by id`;
      const roundParticipantsBefore =
        await sql`select to_jsonb(p) - 'role' as row from round_participants p order by id`;

      const seatsBefore =
        await sql`select id, role, slot from round_participants order by id`;
      const roundsBefore =
        await sql`select id, status, outcome, started_at, completed_at from rounds order by id`;
      await scratch.migrate(() => true);
      assert({
        given: 'populated main migrated through all five Tab folders',
        should: 'keep every unrelated row byte-identical',
        actual: await snapshot(sql, unchanged),
        expected: before,
      });
      assert({
        given: 'old side and judge seats',
        should: 'keep identities and slots with the same side or judge meaning',
        actual:
          await sql`select id, case when seat_kind = 'side' then side else seat_kind end as role, slot from round_participants order by id`,
        expected: seatsBefore,
      });
      assert({
        given: 'every existing Round lifecycle and outcome',
        should: 'retain lifecycle, winning side and instants',
        actual:
          await sql`select id, status, winning_side as outcome, started_at, completed_at from rounds order by id`,
        expected: roundsBefore,
      });
      assert({
        given: 'every Room assembly seat and rating season',
        should:
          'retain seats and all season fields while assigning Daisy ownership',
        actual: {
          seats:
            await sql`select id, case when seat_kind = 'side' then side else seat_kind end as role, slot from room_participants order by id`,
          seasons:
            await sql`select to_jsonb(s) - 'organization_id' as row from seasons s order by id`,
        },
        expected: { seats: roomSeatsBefore, seasons: seasonsBefore },
      });
      assert({
        given: 'an existing seated member holding an active Room',
        should: 'retain the exact hold as an active seat',
        actual: await sql`select * from active_seats order by actor_id`,
        expected: activeSeatsBefore,
      });
      assert({
        given: 'all other fields of rewritten Rooms, Rounds and participants',
        should:
          'preserve exact identities, owners, configuration, consent, visibility, runtime checkpoints and timestamps',
        actual: {
          rooms:
            await sql`select to_jsonb(r) - array['rules_snapshot', 'capture', 'lobby_id', 'lobby_kind', 'template_id', 'ballot_definition_id', 'ballot_definition_version'] as row from rooms r order by id`,
          rounds:
            await sql`select to_jsonb(r) - array['rules_snapshot', 'capture', 'winning_side', 'ranking', 'judging'] as row from rounds r order by id`,
          roomParticipants:
            await sql`select to_jsonb(p) - array['seat_kind', 'side'] as row from room_participants p order by id`,
          roundParticipants:
            await sql`select to_jsonb(p) - array['seat_kind', 'side'] as row from round_participants p order by id`,
        },
        expected: {
          rooms: roomsBefore,
          rounds: roundFieldsBefore,
          roomParticipants: roomParticipantsBefore,
          roundParticipants: roundParticipantsBefore,
        },
      });
      const rulesAfter =
        await sql`select id, rules_snapshot from rooms union all select id, rules_snapshot from rounds`;
      assert({
        given: 'each stored two-sided format and rules snapshot',
        should: 'parse and mean exactly the same timetable and seats',
        actual: rulesAfter
          .map((r: { id: string; rules_snapshot: unknown }) => ({
            id: r.id,
            parses: roundRulesSchema.safeParse(r.rules_snapshot).success,
            rules: r.rules_snapshot,
          }))
          .sort((a: { id: string }, b: { id: string }) =>
            a.id.localeCompare(b.id),
          ),
        expected: [...expectedRules]
          .map(([id, rules]) => ({ id, parses: true, rules }))
          .sort((a: { id: string }, b: { id: string }) =>
            a.id.localeCompare(b.id),
          ),
      });
      const [invalid] =
        await sql`select count(*)::int as count from pg_constraint where connamespace = 'public'::regnamespace and not convalidated`;
      assert({
        given: 'the populated database after every migration',
        should: 'have every CHECK and foreign key validated',
        actual: invalid!.count,
        expected: 0,
      });
      process.stdout.write(
        `STAGING REHEARSAL: ${expectedRules.size - roundIds.length} formats/Rooms, ${roundIds.length} Rounds, ${seatsBefore.length} seats; ${unchanged.length} unchanged tables including rating ledger, recordings, chat and beta preserved; all constraints validated\n`,
      );
    } finally {
      await sql.close();
    }
  },
  ddlTimeoutMs * 4,
);
