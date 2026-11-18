import { afterAll } from 'bun:test';
import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, test } from 'riteway/bun';
import {
  ratingStyles,
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
import { Fixture, rejectedBy } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';
import { integrationSuite } from './suite.test-support';

const { databaseUrl } = integrationSuite();
const scratch = scratchDatabase(databaseUrl, 'stagingrehearsal');
afterAll(() => scratch.drop());

// Every feature-only folder, including the wiring migration. The initial
// database runs every main folder that sorts before the first Tab folder;
// main folders after the Tab merge (ladder divisions, ADR 0147) build on it
// and run with the rest at the end.
const parentFolders = new Set([
  '20261117122348_tab_schema',
  '20261117122349_tab_schema_checks_validated',
  '20261117122350_tab_seats',
  '20261117122351_tab_seats_checks_validated',
  '20261117122352_tab_casual_templates',
  '20261117122353_tab_wiring',
  '20261117122354_lethal_grey_gargoyle',
  '20261117122355_tab_finalization_assignment_cascade',
  '20261117122356_tab_room_seat_teams',
  '20261117134249_tab_notifications',
  '20261117134250_tab_seat_and_notification_checks_validated',
  '20261117180901_tab_room_holds_host',
  '20261117195735_tab_legacy_egress_settled',
  // Host tiers (ADR 0149) build on the Tab tables.
  '20261118153922_host_tiers',
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
const snapshot = async (
  sql: SQL,
  tables: readonly string[],
  columns: Readonly<Record<string, readonly string[]>>,
) =>
  Object.fromEntries(
    await Promise.all(
      tables.map(async (table) => [
        table,
        (
          await (async () => {
            const current: string[] = (
              await sql`select column_name from information_schema.columns where table_schema='public' and table_name=${table}`
            ).map((r: { column_name: string }) => r.column_name);
            const added = current.filter(
              (name) => !columns[table]!.includes(name),
            );
            // Added fields are qualified separately. Any removed old field still
            // disappears from the JSON and fails equality for an existing row.
            return sql.unsafe(
              `select coalesce(jsonb_agg(row order by row::text), '[]'::jsonb) as rows from (select to_jsonb(t) - ARRAY[${added.map((name) => `'${name.replaceAll("'", "''")}'`).join(',')}]::text[] as row from ${table} t) s`,
            );
          })()
        )[0]!.rows,
      ]),
    ),
  );

test(
  'main data survives every parent migration with the same competitive and social meaning',
  async () => {
    await scratch.create();
    const firstParentFolder = [...parentFolders].sort()[0]!;
    await scratch.migrate((folder) => folder < firstParentFolder);
    const sql = new SQL(scratch.url, { max: 1 });
    const f = new Fixture(sql);
    try {
      const [baseline] =
        await sql`select count(*)::int count from drizzle.__drizzle_migrations`;
      process.stdout.write(
        `STAGING REHEARSAL MAIN BASELINE: ${baseline!.count} applied migrations before any Tab folder\n`,
      );
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
      const legacyRules = new Map<string, unknown>();
      const legacyJudges: {
        roundId: string;
        slot: number;
        participantId: string;
        actorId: string;
      }[] = [];
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
      // Main accepted these stored snapshots and seat positions. Migration must
      // observe their actual identities without inventing a repaired grammar.
      const baseFormat = catalog.find(({ id }) => id === 'freestyle')!;
      const compiledLegacy = resolveRoomConfiguration(
        baseFormat.definition,
        baseFormat.config,
      );
      if (!compiledLegacy.ok)
        throw new Error('Legacy reference did not compile');
      for (const judgeCount of [null, 'not-a-count', '1', -1, 257, 1.5, 0, 1]) {
        const legacy = oldRules(compiledLegacy.rules);
        const seats: Record<string, unknown> = { ...legacy.seats };
        if (judgeCount === null) delete seats.judge;
        else seats.judge = judgeCount;
        const round = await f.round({
          format_id: baseFormat.id,
          format_version: baseFormat.version,
          rules_snapshot: { ...legacy, seats },
        });
        roundIds.push(round);
        legacyRules.set(round, {
          ...compiledLegacy.rules,
          seats: { ...compiledLegacy.rules.seats, judges: judgeCount },
        });
        // Include both no judge participants and an actual judge beyond the frozen count.
        if (judgeCount === 1 || judgeCount === 'not-a-count') {
          const actorId = await f.actor(),
            slot = 3;
          const { id: participantId } = await f.seat(
            round,
            'judge',
            slot,
            actorId,
          );
          legacyJudges.push({ roundId: round, slot, participantId, actorId });
        }
      }
      // Rated history on Daisy's one ladder (ADR 0142: Freestyle), with human
      // and bot seats and its actual ledger FK chain. The format corpus above
      // also keeps every lifecycle, including winnerless abandoned and
      // unstarted Rounds.
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
      for (const ladder of ratingStyles) {
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
        const legacyJudge = await f.actor();
        const { id: legacyParticipant } = await f.seat(
          rated,
          'judge',
          3,
          legacyJudge,
        );
        legacyJudges.push({
          roundId: rated,
          slot: 3,
          participantId: legacyParticipant,
          actorId: legacyJudge,
        });
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
      for (const judge of legacyJudges.filter((j) =>
        expectedRules.has(j.roundId),
      )) {
        const [rated] =
          await sql`select ladder_id from rounds where id=${judge.roundId}`;
        await f.insert('rating_changes', {
          id: createId(),
          round_id: judge.roundId,
          actor_id: judge.actorId,
          format_id: rated!.ladder_id,
          ladder: rated!.ladder_id,
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
      // Staging's pre-Tab capture: Egress recorded, nothing dispatched under
      // Tab's protocol. Finished ones of over Rounds settle at their own end;
      // anything still live, or of a running Round, is left to the reconciler.
      const ended = new Date('2026-11-01T11:00:00Z');
      const legacyBroadcasts = {
        completed: { id: createId(), round: roundIds[6]!, done: true },
        abandoned: { id: createId(), round: roundIds[3]!, done: true },
        live: { id: createId(), round: roundIds[1]!, done: false },
        runningRound: { id: createId(), round: roundIds[5]!, done: true },
      };
      for (const { id, round: on, done } of Object.values(legacyBroadcasts))
        await sql`insert into broadcasts (id, round_id, feed_key, release_policy, egress_id, egress_generation, egress_started_at, observer_revoked_at, stream_ended_at, completed_at, feed_withdrawn_at)
          values (${id}, ${on}, ${createId()}, ${JSON.stringify({ kind: 'delay', seconds: 60 })}::text::jsonb, ${`EG_${id}`}, 1, ${at}, ${done ? ended : null}, ${done ? ended : null}, ${done ? ended : null}, ${done ? ended : null})`;
      await sql`insert into recording_captures (recording_id, round_id, egress_id, egress_generation, egress_started_at, observer_revoked_at, ended_at)
        values (${recording}, ${roundIds[2]!}, 'EG_ended_capture', 1, ${at}, ${ended}, ${ended})`;
      const [requested] =
        await sql`select id from recordings where round_id = ${round}`;
      await sql`insert into recording_captures (recording_id, round_id, egress_id, egress_generation, egress_started_at)
        values (${requested!.id}, ${round}, 'EG_live_capture', 1, ${at})`;
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
      // Main's public profile rows (ADR 0143) and a report of each profile
      // kind, plus ballot feedback: Tab renames feedback_side and replaces its
      // check after these exist.
      const profile = createId();
      const photo = createId();
      await f.insert('member_profiles', {
        actor_id: host,
        id: profile,
        display_name: 'Retained Host',
        bio: 'A retained bio.',
        display_name_changed_at: at,
        bio_changed_at: at,
      });
      await f.insert('profile_photos', {
        id: photo,
        actor_id: host,
        status: 'published',
        check_verdict: 'allow',
        object_prefix: `profile-photos/${photo}`,
        decided_at: at,
      });
      const reporter = await f.user();
      for (const [targetKind, targetId, feedbackSide, reason] of [
        ['profile_display_name', profile, null, 'harassment'],
        ['profile_bio', profile, null, 'hate'],
        ['profile_photo', photo, null, 'sexual_content'],
        ['ballot_feedback', round, 'affirmative', 'abusive_feedback'],
      ] as const)
        await f.insert('content_reports', {
          id: createId(),
          reporter_user_id: reporter,
          target_kind: targetKind,
          target_id: targetId,
          feedback_side: feedbackSide,
          reason,
          queue: 'safety',
          created_at: at,
        });
      // Main's seat model (ADR 0145, #766): open seats, each side rule and a
      // frozen seat draw exist before any Tab folder rewrites the seats.
      await sql`update room_participants set team_open = true, position_open = true where role = 'negative'`;
      await sql`update room_participants set position_open = true where id = (select id from room_participants where role = 'affirmative' order by id limit 1)`;
      await sql`update rooms set team_one_side = null where id = (select id from rooms where competition_type = 'casual' order by id limit 1)`;
      await sql`update rooms set team_one_side = 'negative' where id = (select id from rooms where competition_type = 'casual' order by id offset 1 limit 1)`;
      const seatDraw = {
        algorithm: 'daisy-draw-v1/seats',
        commitment: '0'.repeat(64),
        coin: 'swapped',
        teamOneSide: 'negative',
        moved: [],
      };
      await sql`update rounds set seat_draw = ${seatDraw}::jsonb where id = ${round}`;
      const seatModel = async () => ({
        seats:
          await sql`select id, team_open, position_open from room_participants order by id`,
        sides: await sql`select id, team_one_side from rooms order by id`,
        draws:
          await sql`select id, seat_draw from rounds where seat_draw is not null order by id`,
      });
      const seatModelBefore = await seatModel();
      // Main's notification catalogue (ADR 0144, #767): kinds Tab's own
      // checks never listed, and a presentation choice, before any Tab folder.
      const [hostUser] = await sql`select user_id from actors where id=${host}`;
      for (const [kind, about] of [
        ['round_started', null],
        ['round_decision_released', host],
      ] as const)
        await f.insert('notifications', {
          id: createId(),
          user_id: hostUser!.user_id,
          kind,
          round_id: round,
          actor_id: about,
          created_at: at,
          surfaced_at: at,
        });
      await f.insert(
        'notification_presentation',
        {
          user_id: hostUser!.user_id,
          toasts: false,
          sound: true,
          desktop_alerts: false,
          email: true,
        },
        'user_id',
      );
      const notificationsBefore =
        await sql`select to_jsonb(n) as row from notifications n order by id`;
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
        'content_reports',
      ];
      const unchanged: string[] = (
        await sql`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') order by relname`
      )
        .map((row: { relname: string }) => row.relname)
        .filter((name: string) => !rewritten.includes(name));
      const roomSeatsBefore =
        await sql`select id, role, slot from room_participants order by id`;
      const seasonsBefore =
        await sql`select to_jsonb(s) as row from seasons s order by id`;
      const columns = Object.fromEntries(
        await Promise.all(
          unchanged.map(async (table) => [
            table,
            (
              await sql`select column_name from information_schema.columns where table_schema='public' and table_name=${table} order by ordinal_position`
            ).map((r: { column_name: string }) => r.column_name),
          ]),
        ),
      );
      const before = await snapshot(sql, unchanged, columns);
      const roomsBefore =
        await sql`select to_jsonb(r) - array['rules_snapshot', 'capture'] as row from rooms r order by id`;
      const roundFieldsBefore =
        await sql`select to_jsonb(r) - array['rules_snapshot', 'capture', 'outcome'] as row from rounds r order by id`;
      const roomParticipantsBefore =
        await sql`select to_jsonb(p) - 'role' as row from room_participants p order by id`;
      const roundParticipantsBefore =
        await sql`select to_jsonb(p) - 'role' as row from round_participants p order by id`;

      const reportsBefore =
        await sql`select to_jsonb(c) - 'feedback_side' as row, feedback_side as subject from content_reports c order by id`;
      const seatsBefore =
        await sql`select id, role, slot from round_participants order by id`;
      const roundsBefore =
        await sql`select id, status, outcome, started_at, completed_at from rounds order by id`;
      await scratch.migrate(() => true);
      assert({
        given: 'populated main migrated through every parent and wiring folder',
        should: 'keep every unrelated row byte-identical',
        actual: await snapshot(sql, unchanged, columns),
        expected: before,
      });
      assert({
        given: "main's profile and ballot feedback reports",
        should: 'keep every report, its side now its feedback subject',
        actual:
          await sql`select to_jsonb(c) - 'feedback_subject' as row, feedback_subject as subject from content_reports c order by id`,
        expected: reportsBefore,
      });
      assert({
        given:
          "main's notifications of kinds Tab's checks never listed (ADR 0144)",
        should: 'keep every row, with no Tab subject named',
        actual:
          await sql`select to_jsonb(n) - array['fixture_id','notification_lobby_id','tab_command_id','media_release_request_id','media_release_id','media_release_club_ask_id'] as row from notifications n order by id`,
        expected: notificationsBefore,
      });
      assert({
        given:
          "main's open seats, side rules and a frozen seat draw (ADR 0145)",
        should: 'keep every one through the Tab folders',
        actual: await seatModel(),
        expected: seatModelBefore,
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
          'retain seats and all season fields while assigning Daisy ownership and the Open division (ADR 0147)',
        actual: {
          seats:
            await sql`select id, case when seat_kind = 'side' then side else seat_kind end as role, slot from room_participants order by id`,
          seasons:
            await sql`select to_jsonb(s) - 'organization_id' - 'division' as row from seasons s order by id`,
          divisions: await sql`select distinct division from seasons`,
        },
        expected: {
          seats: roomSeatsBefore,
          seasons: seasonsBefore,
          divisions: [{ division: 'open' }],
        },
      });
      assert({
        given: 'an existing seated member holding an active Room',
        should: 'retain the exact hold as an active seat',
        actual: await sql`select * from active_seats order by actor_id`,
        expected: activeSeatsBefore,
      });
      const retainedBefore = {
        rooms: roomsBefore,
        rounds: roundFieldsBefore,
        roomParticipants: roomParticipantsBefore,
        roundParticipants: roundParticipantsBefore,
      };
      const retainedAfter = {
        rooms:
          await sql`select to_jsonb(r) - array['rules_snapshot','capture','lobby_id','lobby_kind','template_id','standing_template_id','ballot_definition_id','ballot_definition_version','league_ladder_id','holds_host'] as row from rooms r order by id`,
        rounds:
          await sql`select to_jsonb(r) - array['rules_snapshot','capture','winning_side','ranking','judging','ballot_definition_id','ballot_definition_version','league_ladder_id','ladder_division'] as row from rounds r order by id`,
        roomParticipants:
          await sql`select to_jsonb(p) - array['seat_kind','side'] as row from room_participants p order by id`,
        roundParticipants:
          await sql`select to_jsonb(p) - array['seat_kind','side','rating_actor_id','legacy_rating_participant'] as row from round_participants p order by id`,
      };
      assert({
        given: 'all other fields of rewritten Rooms, Rounds and participants',
        should:
          'preserve exact identities, owners, configuration, consent, visibility, runtime checkpoints and timestamps',
        actual: retainedAfter,
        expected: retainedBefore,
      });
      assert({
        given: 'pre-Tab Broadcasts and captures with a recorded Egress',
        should:
          'settle a finished one of an over Round at its own end, and leave a live one or one of a running Round unsettled',
        actual: {
          broadcasts: Object.fromEntries(
            await Promise.all(
              Object.entries(legacyBroadcasts).map(async ([name, { id }]) => [
                name,
                (
                  await sql`select egress_settled_at from broadcasts where id = ${id}`
                )[0]!.egress_settled_at,
              ]),
            ),
          ),
          captures:
            await sql`select egress_id, egress_settled_at from recording_captures order by egress_id`,
        },
        expected: {
          broadcasts: {
            completed: ended,
            abandoned: ended,
            live: null,
            runningRound: null,
          },
          captures: [
            { egress_id: 'EG_ended_capture', egress_settled_at: ended },
            { egress_id: 'EG_live_capture', egress_settled_at: null },
          ],
        },
      });
      assert({
        given: 'every existing Room (decision 75)',
        should:
          'hold no seatless host: only a Train practice created from now on holds its host',
        actual: (
          await sql`select count(*)::int n from rooms where holds_host`
        )[0]!.n,
        expected: 0,
      });
      assert({
        given: 'ordinary Rooms and Rounds that predate league rating selection',
        should:
          'leave their league selection absent rather than silently rating old play',
        actual: [
          (
            await sql`select count(*)::int n from rooms where league_ladder_id is not null`
          )[0]!.n,
          (
            await sql`select count(*)::int n from rounds where league_ladder_id is not null`
          )[0]!.n,
        ],
        expected: [0, 0],
      });
      const rulesAfter =
        await sql`select id, rules_snapshot from rooms union all select id, rules_snapshot from rounds`;
      assert({
        given: 'each stored two-sided format and rules snapshot',
        should: 'parse and mean exactly the same timetable and seats',
        actual: rulesAfter
          .filter((r: { id: string }) => !legacyRules.has(r.id))
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
      assert({
        given:
          'stored snapshots missing or carrying invalid frozen judge counts',
        should:
          'preserve the historical snapshot rather than invent valid rules',
        actual: rulesAfter
          .filter((r: { id: string }) => legacyRules.has(r.id))
          .map((r: { id: string; rules_snapshot: unknown }) => ({
            id: r.id,
            rules: r.rules_snapshot,
          }))
          .sort((a: { id: string }, b: { id: string }) =>
            a.id.localeCompare(b.id),
          ),
        expected: [...legacyRules]
          .map(([id, rules]) => ({ id, rules }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      });
      assert({
        given:
          'actual main judge identities outside their declared or missing frozen count',
        should:
          'retain an observed slot and assignment for every actual judge without changing a seat',
        actual:
          await sql`select a.round_id, a.slot, a.participant_id, a.actor_id,a.source from round_judge_assignments a order by a.round_id,a.slot`,
        expected:
          await sql`select round_id,slot,id participant_id,actor_id,'observed' source from round_participants where seat_kind='judge' order by round_id,slot`,
      });
      assert({
        given: 'actual pre-migration ratings on non-debating identities',
        should:
          'retain exactly those historical identities as immutable legacy rating provenance',
        actual:
          await sql`select p.id,p.rating_actor_id from round_participants p where p.legacy_rating_participant order by p.id`,
        expected:
          await sql`select distinct p.id,p.actor_id rating_actor_id from round_participants p join rating_changes c on c.round_id=p.round_id and c.actor_id=p.actor_id where p.seat_kind not in ('side','speaker') order by p.id`,
      });
      const markerRound = await f.round({
        format_id: baseFormat.id,
        format_version: baseFormat.version,
        rules_snapshot: compiledLegacy.rules,
      });
      const markerActor = await f.actor();
      assert({
        given:
          'a future judge attempting to manufacture historical rating provenance',
        should:
          'refuse a new legacy marker and any rewrite of observed history',
        actual: [
          await rejectedBy(
            () =>
              sql`insert into round_participants(id,round_id,actor_id,seat_kind,side,slot,legacy_rating_participant) values(${createId()},${markerRound},${markerActor},'judge',null,0,true)`,
          ),
          await rejectedBy(
            () =>
              sql`update round_participants set legacy_rating_participant=false where legacy_rating_participant`,
          ),
        ],
        expected: [
          'round_participants_legacy_rating_marker',
          'round_participants_identity_immutable',
        ],
      });
      assert({
        given:
          'the original missing-count stored snapshot after a successful migration',
        should:
          'still fail the strict future-write grammar check rather than weakening it to admit history',
        actual: await rejectedBy(
          () =>
            sql`select daisy_round_judge_slot_count(rules_snapshot) from rounds where id=${[...legacyRules.keys()][0]!}`,
        ),
        expected: 'round_judge_slots_frozen_count',
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
        `STAGING REHEARSAL: ${expectedRules.size - roundIds.length + legacyRules.size} formats/Rooms, ${roundIds.length} Rounds, ${seatsBefore.length} seats; ${unchanged.length} unchanged tables including rating ledger, recordings, chat and beta preserved; all constraints validated\n`,
      );
    } finally {
      await sql.close();
    }
  },
  ddlTimeoutMs * 4,
);
