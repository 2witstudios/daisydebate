import { afterAll } from 'bun:test';
import type { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, test } from 'riteway/bun';
import { resolveRoomConfiguration } from '@daisy/debate-engine';
import {
  ballotSchemaFor,
  ballotSubjectsFor,
  daisyBallotDefinitions,
  formatDefinitionSchema,
  panelRuleFor,
  roundRulesSchema,
  type FormatDefinition,
  type RoundRules,
} from '@daisy/protocol';
import { queueOfReason } from '@daisy/protocol/content-moderation';
import { casualTemplateIds } from '../src/catalog-casual';
import { seededFormats, seededPresets } from '../src/migrations.test-support';
import { seatOfColumns } from '../src/seat-columns';
import { rejectedBy, withFixture, type Fixture } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';
import { integrationSuite } from './suite.test-support';
import { insertRow, refusedBy, withSample } from './tab.test-support';

const { databaseUrl: url } = integrationSuite();

const seats = '20261114151541_tab_seats';
const validated = '20261114152055_tab_seats_checks_validated';
const scratch = scratchDatabase(url, 'tabseats');
afterAll(() => scratch.drop());

/** The checks the first folder adds NOT VALID and the second validates. */
const addedChecks = [
  'ballots_daisy_definition_check',
  'ballots_decision_check',
  'ballots_ranking_check',
  'ballots_rubric_version_check',
  'ballots_winner_check',
  'content_reports_feedback_subject_check',
  'fixture_entries_side_key',
  'room_invitations_seat_check',
  'room_participants_seat_kind_check',
  'room_participants_side_check',
  'room_seat_holds_seat_check',
  'rooms_event_recording',
  'round_commands_type_check',
  'round_participants_seat_kind_check',
  'round_participants_side_check',
  'round_segments_type_check',
  'rounds_judging_is_object',
  'rounds_lifecycle_check',
  'rounds_outcome_check',
  'rounds_platform_ending_check',
  'rounds_ranking_shape_check',
] as const;

/** TAB-6's inverse, for seeding: a version-3 rules snapshot as version 2 stored it. */
const versionTwoRules = ({
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
    if (seat?.kind !== 'side') throw new Error('A two-sided segment is led');
    return { ...segment, side: seat.side, slot: seat.slot };
  }),
});

/** A rubric's categories, every one at `score`. */
const scored = (
  score: number,
  rubric: 'speaker-10@1' | 'speaker-10@2' = 'speaker-10@2',
) => {
  const criteria = daisyBallotDefinitions[rubric].points?.criteria;
  const categories =
    criteria?.kind === 'grid'
      ? criteria.groups.flatMap((group) => group.categories.map(({ id }) => id))
      : [];
  return Object.fromEntries(categories.map((category) => [category, score]));
};

const definitionFor = (formatId: string, version: number) => {
  const format = seededFormats.find(({ id }) => id === formatId);
  const definition = format?.revisions[version - 1];
  if (!definition) throw new Error(`No reference ${formatId}@${version}`);
  return definition as FormatDefinition;
};

/**
 * Each catalog format's current preset compiled against its current
 * definition: the formats the database held before the seats migration, so
 * not the casual templates a later migration adds (TAB-6.18).
 */
const compiledCatalog = () =>
  seededFormats
    .filter(({ id }) => !casualTemplateIds.includes(id))
    .flatMap(({ id, revisions }) => {
      const formatVersion = revisions.length;
      const preset = seededPresets
        .filter(
          (candidate) =>
            candidate.formatId === id &&
            candidate.formatVersion === formatVersion,
        )
        .at(-1);
      if (!preset) return [];
      const compiled = resolveRoomConfiguration(
        definitionFor(id, formatVersion),
        preset.config as Parameters<typeof resolveRoomConfiguration>[1],
      );
      if (!compiled.ok) throw new Error(`${id} does not compile`);
      return [{ formatId: id, formatVersion, rules: compiled.rules }];
    });

type Seeded = {
  readonly rounds: readonly {
    readonly id: string;
    readonly formatId: string;
    readonly rules: RoundRules;
    readonly outcome: 'affirmative' | 'negative' | null;
    readonly rubric: 'speaker-10@1' | 'speaker-10@2' | null;
  }[];
  readonly rooms: readonly {
    readonly id: string;
    readonly rules: RoundRules;
    readonly recording: boolean;
  }[];
  readonly host: string;
  readonly seatedMember: string;
  readonly evidenceId: string;
  readonly commandId: string;
  readonly reportId: string;
};

const oldSeat = async (
  fixture: Fixture,
  table: 'room_participants' | 'round_participants',
  owner: Record<string, string>,
  role: string,
) => {
  const actorId = await fixture.actor();
  await fixture.insert(table, {
    id: createId(),
    ...owner,
    actor_id: actorId,
    role,
    slot: 0,
  });
  return actorId;
};

/** Old-shape rows across every table the folder rewrites. */
const seedOldShapes = async (fixture: Fixture): Promise<Seeded> => {
  const host = await fixture.actor();
  const catalog = compiledCatalog();
  const outcomes = ['affirmative', 'negative', null] as const;
  const rounds: Seeded['rounds'][number][] = [];
  const rooms: Seeded['rooms'][number][] = [];
  for (const [index, { formatId, formatVersion, rules }] of catalog.entries()) {
    const roomId = await fixture.room(host, formatId, {
      format_version: formatVersion,
      rules_snapshot: versionTwoRules(rules),
      capture: { broadcast: null, recording: index % 2 === 0 },
    });
    rooms.push({ id: roomId, rules, recording: index % 2 === 0 });
    for (const role of ['affirmative', 'negative', 'judge'])
      await oldSeat(fixture, 'room_participants', { room_id: roomId }, role);
    const outcome = outcomes[index % outcomes.length]!;
    const judged = outcome !== null;
    const rubric = judged
      ? index % 4 === 0
        ? ('speaker-10@1' as const)
        : ('speaker-10@2' as const)
      : null;
    const roundId = createId();
    await fixture.insert('rounds', {
      id: roundId,
      room_id: null,
      created_by_actor_id: host,
      resolution: 'A resolution',
      competition_type: 'casual',
      format_id: formatId,
      format_version: formatVersion,
      preset_version: null,
      rules_snapshot: versionTwoRules(rules),
      capture: { broadcast: null, recording: index % 2 === 1 },
      status: 'completed',
      current_stage: null,
      outcome,
      ladder_id: null,
      started_at: new Date('2026-11-01T10:00:00.000Z'),
      completed_at: new Date('2026-11-01T11:00:00.000Z'),
    });
    rounds.push({ id: roundId, formatId, rules, outcome, rubric });
    const debaters: Record<string, string> = {};
    for (const side of ['affirmative', 'negative']) {
      const id = createId();
      await fixture.insert('round_participants', {
        id,
        round_id: roundId,
        actor_id: await fixture.actor(),
        role: side,
        slot: 0,
      });
      debaters[side] = id;
    }
    if (!judged || !rubric) continue;
    const judgeSeat = createId();
    await fixture.insert('round_participants', {
      id: judgeSeat,
      round_id: roundId,
      actor_id: await fixture.actor(),
      role: 'judge',
      slot: 0,
    });
    const revision = await fixture.freeze(roundId);
    await fixture.insert('ballots', {
      id: createId(),
      judge_participant_id: judgeSeat,
      round_id: roundId,
      freeze_revision: revision,
      rubric_version: rubric,
      winner: outcome,
      scores: { affirmative: scored(4, rubric), negative: scored(3, rubric) },
      reason: 'The affirmative carried the burden.',
      feedback: { affirmative: 'Clear.', negative: 'Weigh more.' },
      citations: {
        affirmative: {
          [Object.keys(scored(4, rubric))[0]!]: {
            turn: 'AC',
            note: 'Opening.',
          },
        },
      },
      submitted_at: new Date('2026-11-01T11:00:00.000Z'),
    });
  }
  const [firstRoom, secondRoom] = rooms;
  if (!firstRoom || !secondRoom) throw new Error('The catalog seeds Rooms');
  // A debater's and a judge's hold, and the invitations that hold them.
  const holders = [await fixture.actor(), await fixture.actor()];
  for (const [index, seat] of ['debater', 'judge'].entries()) {
    await fixture.sql`insert into room_seat_holds (room_id, actor_id, seat, until)
      values (${firstRoom.id}, ${holders[index]}, ${seat}, now() + interval '1 hour')`;
    await fixture.insert('room_invitations', {
      id: createId(),
      room_id: secondRoom.id,
      invitee_actor_id: holders[index],
      inviter_actor_id: host,
      seat,
      state: 'pending',
      expires_at: new Date(Date.now() + 3_600_000),
    });
  }
  // The host held without a seat, and a seated member held in that Room.
  const [seatedMember] =
    (await fixture.sql`select actor_id from room_participants
    where room_id = ${firstRoom.id} and role = 'affirmative'`) as {
      actor_id: string;
    }[];
  await fixture.sql`insert into room_active_memberships (actor_id, room_id)
    values (${host}, ${firstRoom.id}), (${seatedMember!.actor_id}, ${firstRoom.id})`;
  // A receipt whose outcome was the winning side, and an evidence speaker by role.
  const [judgedRound] = rounds.filter((round) => round.outcome !== null);
  const commandId = createId();
  await fixture.insert(
    'round_commands',
    {
      command_id: commandId,
      round_id: judgedRound!.id,
      service_id: 'round-finalization:fixture',
      type: 'complete',
      payload_digest: 'a'.repeat(64),
      result: { ruling: 'ruled', outcome: judgedRound!.outcome },
      resulting_version: 2,
      applied_at: new Date('2026-11-01T11:00:00.000Z'),
    },
    'command_id',
  );
  const evidenceId = createId();
  const speakerSeat = createId();
  await fixture.sql`insert into necessary_evidence(id,round_id,original_round_id,session_id,segment_id,round_participant_id,worker_id,capture_epoch,binding_digest,state,retirement_reason,reserved_bytes,authority_id,original_speaker)
    values(${evidenceId},null,${judgedRound!.id},${createId()},${createId()},${speakerSeat},${createId()},1,${'b'.repeat(64)},'retiring','erased',0,${'c'.repeat(24)},
    ${{ roundParticipantId: speakerSeat, actorId: host, kind: 'human', role: 'negative', slot: 0 }})`;
  // A debater's report of the feedback written to their side.
  const reportId = createId();
  await fixture.sql`insert into content_reports (id, target_kind, target_id, feedback_side, reason, queue)
    select ${reportId}, 'ballot_feedback', id, 'negative', 'abusive_feedback',
      ${queueOfReason('abusive_feedback')}
    from ballots limit 1`;
  return {
    rounds,
    rooms,
    host,
    seatedMember: seatedMember!.actor_id,
    evidenceId,
    commandId,
    reportId,
  };
};

const ballotChecksums = (sql: SQL) =>
  sql`select id, md5(coalesce(winner, '') || scores::text || coalesce(feedback::text, '') || coalesce(citations::text, '') || reason) as sum
    from ballots order by id` as Promise<{ id: string; sum: string }[]>;

const validity = async (sql: SQL) =>
  Object.fromEntries(
    (
      (await sql`select conname, convalidated from pg_constraint
        where conname in ${sql([...addedChecks])} order by conname`) as {
        conname: string;
        convalidated: boolean;
      }[]
    ).map((row) => [row.conname, row.convalidated]),
  );

/**
 * The seeded proof for the TAB-6 folders: every table they rewrite holds
 * rows on a deployed database, and CI migrates only empty ones.
 */
test(
  'the seats migration rewrites every stored seat, outcome, ballot, rules and capture into the one new shape',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < seats);
    await withFixture(scratch.url, async (fixture) => {
      const seeded = await seedOldShapes(fixture);
      const { sql } = fixture;
      const rolesBefore = (await sql`
        select 'room' as owner, id, role, slot from room_participants
        union all select 'round', id, role, slot from round_participants
        order by 2`) as {
        owner: string;
        id: string;
        role: string;
        slot: number;
      }[];
      const outcomesBefore = await sql`select id, outcome from rounds
        where outcome is not null order by id`;
      const ballotsBefore = await ballotChecksums(sql);

      await scratch.migrate((folder) => folder <= seats);
      const afterSeats = await validity(sql);
      await scratch.migrate((folder) => folder <= validated);

      const seatsAfter = (await sql`
        select 'room' as owner, id, seat_kind, side, slot from room_participants
        union all select 'round', id, seat_kind, side, slot from round_participants
        order by 2`) as {
        owner: string;
        id: string;
        seat_kind: 'side' | 'judge';
        side: string | null;
        slot: number;
      }[];
      const holds = await sql`select seat from room_seat_holds order by seat`;
      const invitations = await sql`select seat from room_invitations
        where inviter_actor_id = ${seeded.host} order by seat`;
      const outcomesAfter =
        await sql`select id, winning_side as outcome from rounds
        where winning_side is not null or ranking is not null order by id`;
      const ballotsAfter = await ballotChecksums(sql);
      const rounds =
        (await sql`select id, rules_snapshot, judging, capture from rounds`) as {
          id: string;
          rules_snapshot: unknown;
          judging: unknown;
          capture: unknown;
        }[];
      const roomsAfter =
        (await sql`select id, rules_snapshot, capture from rooms
        where host_actor_id = ${seeded.host}`) as {
          id: string;
          rules_snapshot: unknown;
          capture: unknown;
        }[];
      const definitions = (await sql`select format_id, version, definition
        from format_revisions`) as {
        format_id: string;
        version: number;
        definition: unknown;
      }[];
      const ballots =
        (await sql`select b.round_id, b.rubric_version, b.decision, b.winner,
          b.ranking, b.scores, b.reason, b.feedback, b.citations
        from ballots b`) as {
          round_id: string;
          rubric_version: string;
          decision: string;
          winner: string;
          ranking: unknown;
          scores: Record<string, unknown>;
          reason: string;
          feedback: Record<string, string>;
          citations: Record<string, unknown>;
        }[];
      const participantsOf = async (roundId: string) =>
        (
          (await sql`select id, seat_kind as "seatKind", side, slot
            from round_participants where round_id = ${roundId}`) as {
            id: string;
            seatKind: 'side' | 'judge';
            side: string | null;
            slot: number;
          }[]
        ).map(({ id, ...seat }) => ({ id, seat: seatOfColumns(seat) }));
      const ballotParses = await Promise.all(
        ballots.map(async (ballot) => {
          const round = rounds.find(({ id }) => id === ballot.round_id)!;
          const judging = round.judging as {
            ballot: (typeof daisyBallotDefinitions)['speaker-10@2'];
          };
          return ballotSchemaFor(
            judging.ballot,
            ballotSubjectsFor(
              round.rules_snapshot as RoundRules,
              await participantsOf(round.id),
            ),
          ).safeParse({
            rubricVersion: ballot.rubric_version,
            winner: ballot.winner,
            reason: ballot.reason,
            feedback: ballot.feedback,
            scores: ballot.scores,
            citations: ballot.citations,
          }).success;
        }),
      );
      const [command] = await sql`select result from round_commands
        where command_id = ${seeded.commandId}`;
      const [evidence] =
        await sql`select original_speaker from necessary_evidence
        where id = ${seeded.evidenceId}`;
      const [report] = await sql`select feedback_subject from content_reports
        where id = ${seeded.reportId}`;
      const held = await sql`select actor_id from active_seats
        where actor_id in ${sql([seeded.host, seeded.seatedMember])}`;
      const judgedRound = seeded.rounds.find(
        (round) => round.outcome !== null,
      )!;
      const judgingOf = (rubric: 'speaker-10@1' | 'speaker-10@2') => ({
        ballot: daisyBallotDefinitions[rubric],
        panel: panelRuleFor(daisyBallotDefinitions[rubric]),
      });

      const actual = {
        seats: seatsAfter,
        holds: holds.map((row: { seat: string }) => row.seat),
        invitations: invitations.map((row: { seat: string }) => row.seat),
        outcomes: outcomesAfter,
        ballotChecksums: ballotsAfter,
        ballotDecisions: ballots.map((ballot) => [
          ballot.decision,
          ballot.ranking,
        ]),
        ballotsParse: ballotParses,
        judging: Object.fromEntries(
          rounds
            .filter((round) => seeded.rounds.some(({ id }) => id === round.id))
            .map((round) => [round.id, round.judging]),
        ),
        roundRules: Object.fromEntries(
          rounds
            .filter((round) => seeded.rounds.some(({ id }) => id === round.id))
            .map((round) => [round.id, round.rules_snapshot]),
        ),
        roomRules: Object.fromEntries(
          roomsAfter.map((room) => [room.id, room.rules_snapshot]),
        ),
        rulesParse: [...rounds, ...roomsAfter].every(
          (row) => roundRulesSchema.safeParse(row.rules_snapshot).success,
        ),
        definitions: Object.fromEntries(
          definitions.map((row) => [
            `${row.format_id}@${row.version}`,
            row.definition,
          ]),
        ),
        definitionsParse: definitions.every(
          (row) => formatDefinitionSchema.safeParse(row.definition).success,
        ),
        roomCapture: Object.fromEntries(
          roomsAfter.map((room) => [room.id, room.capture]),
        ),
        roundCapture: Object.fromEntries(
          rounds
            .filter((round) => seeded.rounds.some(({ id }) => id === round.id))
            .map((round) => [round.id, round.capture]),
        ),
        receiptOutcome: command?.result.outcome,
        evidenceSpeaker: evidence?.original_speaker.seat,
        held: held.map((row: { actor_id: string }) => row.actor_id),
        reportSubject: report?.feedback_subject,
        afterSeats: Object.values(afterSeats).every((valid) => valid === false),
        validated: await validity(sql),
      };
      const expected = {
        seats: rolesBefore.map(({ owner, id, role, slot }) => ({
          owner,
          id,
          seat_kind: role === 'judge' ? 'judge' : 'side',
          side: role === 'judge' ? null : role,
          slot,
        })),
        holds: ['judge', 'side'],
        invitations: ['judge', 'side'],
        outcomes: outcomesBefore,
        ballotChecksums: ballotsBefore,
        ballotDecisions: ballots.map(() => ['win', null]),
        ballotsParse: ballots.map(() => true),
        judging: Object.fromEntries(
          seeded.rounds.map((round) => [
            round.id,
            judgingOf(round.rubric ?? 'speaker-10@2'),
          ]),
        ),
        roundRules: Object.fromEntries(
          seeded.rounds.map((round) => [round.id, round.rules]),
        ),
        roomRules: Object.fromEntries(
          seeded.rooms.map((room) => [room.id, room.rules]),
        ),
        rulesParse: true,
        definitions: Object.fromEntries(
          definitions.map((row) => [
            `${row.format_id}@${row.version}`,
            definitionFor(row.format_id, row.version),
          ]),
        ),
        definitionsParse: true,
        roomCapture: Object.fromEntries(
          seeded.rooms.map((room) => [
            room.id,
            {
              broadcast: null,
              recordingPolicy: room.recording ? 'released' : 'off',
            },
          ]),
        ),
        roundCapture: Object.fromEntries(
          seeded.rounds.map((round, index) => [
            round.id,
            {
              broadcast: null,
              recordingPolicy: index % 2 === 1 ? 'released' : 'off',
            },
          ]),
        ),
        receiptOutcome: { kind: 'winner', side: judgedRound.outcome },
        evidenceSpeaker: { kind: 'side', side: 'negative', slot: 0 },
        held: [seeded.seatedMember],
        reportSubject: 'negative',
        afterSeats: true,
        validated: Object.fromEntries(addedChecks.map((name) => [name, true])),
      };
      for (const key of Object.keys(expected) as (keyof typeof expected)[])
        assert({
          given:
            'rooms, rounds, seats, holds, invitations, ballots, receipts and evidence written in the old shapes',
          should:
            'say the same thing in seat kinds and sides, winning sides, frozen judging, version-2 definitions, version-3 rules and recording policies',
          actual: { [key]: actual[key] },
          expected: { [key]: expected[key] },
        });
    });
  },
  ddlTimeoutMs * 4,
);

test('the new seat, outcome, ballot and capture CHECKs refuse what the shapes cannot say', async () => {
  await withFixture(url, async (fixture) => {
    const roundId = await fixture.round();
    const seatRow = (columns: Record<string, unknown>) => ({
      id: createId(),
      round_id: roundId,
      slot: 0,
      ...columns,
    });
    const judge = (await fixture.seat(roundId, 'judge')).id;
    await fixture.freeze(roundId);
    assert({
      given:
        'a side seat without its side, a judge seat with one, a side spelled outside the key pattern, a Round with both a winner and a ranking, places that are not groups, and a Daisy ballot with no definition',
      should: 'refuse each with its named CHECK',
      actual: [
        await fixture.rejectedBy(
          'round_participants',
          seatRow({
            actor_id: await fixture.actor(),
            seat_kind: 'side',
            side: null,
          }),
        ),
        await fixture.rejectedBy(
          'round_participants',
          seatRow({
            actor_id: await fixture.actor(),
            seat_kind: 'judge',
            side: 'negative',
          }),
        ),
        await fixture.rejectedBy(
          'round_participants',
          seatRow({
            actor_id: await fixture.actor(),
            seat_kind: 'side',
            side: 'Aff',
          }),
        ),
        await rejectedBy(
          () =>
            fixture.sql`update rounds set status = 'completed', started_at = now() - interval '1 hour',
            completed_at = now(), winning_side = 'affirmative', ranking = ${[['affirmative']]}
            where id = ${roundId}`,
        ),
        await rejectedBy(
          () =>
            fixture.sql`update rounds set status = 'completed', started_at = now() - interval '1 hour',
            completed_at = now(), ranking = ${['affirmative']} where id = ${roundId}`,
        ),
        await fixture.rejectedBy('ballots', {
          id: createId(),
          judge_participant_id: judge,
          round_id: roundId,
          freeze_revision: 1,
          rubric_version: null,
          winner: 'affirmative',
          scores: { affirmative: scored(3), negative: scored(3) },
          reason: 'A reason.',
          submitted_at: new Date(),
        }),
      ],
      expected: [
        'round_participants_side_check',
        'round_participants_side_check',
        'round_participants_side_check',
        'rounds_outcome_check',
        'rounds_ranking_shape_check',
        'ballots_daisy_definition_check',
      ],
    });
  });
});

test(
  'a stored ranking is a non-empty list of non-empty places of keys (TAB-6.18)',
  async () => {
    await withFixture(url, async (f) => {
      const roundId = await f.round();
      const rank = (ranking: unknown) =>
        f.sql`update rounds set status = 'completed', started_at = now() - interval '1 hour',
          completed_at = now(), ranking = ${ranking} where id = ${roundId}`;
      assert({
        given: 'a completed Round ranked in places, then malformed rankings',
        should:
          'store the places, and refuse an empty place, a key that is not text, a place that is not a list, and no places',
        actual: [
          await rank([['a'], ['b', 'c'], ['d']]).then(() => 'stored'),
          await rejectedBy(() => rank([['a'], []])),
          await rejectedBy(() => rank([['a'], [1]])),
          await rejectedBy(() => rank([['a'], 'b'])),
          await rejectedBy(() => rank([])),
        ],
        expected: [
          'stored',
          'rounds_ranking_shape_check',
          'rounds_ranking_shape_check',
          'rounds_ranking_shape_check',
          'rounds_ranking_shape_check',
        ],
      });
    });
  },
  ddlTimeoutMs,
);

test('an event Room never releases its Recording, and a fixture side is a side key', async () => {
  await withSample(url, async (sql, ids) => {
    const draft = createId();
    const ancestry = {
      lobby_id: ids.lobby,
      event_id: ids.debate,
      tab_round_id: ids.round1,
    };
    await insertRow(sql, 'fixtures', {
      id: draft,
      ...ancestry,
      kind: 'pairing',
    });
    assert({
      given:
        "the sample tournament's event Room set to a released Recording, and a fixture entry on a side spelled outside the key pattern",
      should: 'refuse each with its named CHECK',
      actual: [
        await refusedBy(
          sql,
          () =>
            sql`update rooms set capture = ${{ broadcast: null, recordingPolicy: 'released' }}
            where id = ${ids.room}`,
        ),
        await refusedBy(
          sql,
          () => sql`update rooms set capture = null where id = ${ids.room}`,
        ),
        await refusedBy(sql, () =>
          insertRow(sql, 'fixture_entries', {
            fixture_id: draft,
            ...ancestry,
            entry_id: ids.teams[0],
            position: 0,
            side: 'Opening Gov',
          }),
        ),
      ],
      expected: [
        'rooms_event_recording',
        'rooms_event_recording',
        'fixture_entries_side_key',
      ],
    });
  });
});
