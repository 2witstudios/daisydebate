import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { daisyOrganizationId } from '../src/daisy-reference';
import { scopeTransaction, type TenantScope } from '../src/tenant-scope';
import { Fixture, digest } from './constraint-helpers';
import { validConfig, validRules } from './round-fixtures';

type PostgresFailure = { errno?: unknown; constraint?: unknown };
type Row = Readonly<Record<string, unknown>>;

/**
 * One transaction on one connection, always rolled back. The tab record is
 * append-only by trigger, so a suite cannot delete what it wrote; it never
 * commits instead.
 */
export const inRolledBackTransaction = async (
  url: string,
  body: (sql: SQL) => Promise<void>,
) => {
  const sql = new SQL(url, { max: 1 });
  try {
    await sql.unsafe('begin');
    await body(sql);
  } finally {
    try {
      await sql.unsafe('rollback');
    } finally {
      await sql.close();
    }
  }
};

/**
 * What refused the statement: the constraint PostgreSQL named, else its
 * SQLSTATE (42501 for a privilege or a row-level security policy), or null
 * when it was accepted. The attempt runs in a savepoint, so a refusal leaves
 * the surrounding transaction usable.
 */
export const refusedBy = async (
  sql: SQL,
  attempt: () => PromiseLike<unknown>,
): Promise<string | null> => {
  await sql.unsafe('savepoint attempt');
  try {
    await attempt();
    await sql.unsafe('release savepoint attempt');
    return null;
  } catch (error) {
    await sql.unsafe('rollback to savepoint attempt');
    const { errno, constraint } = error as PostgresFailure;
    if (typeof errno !== 'string') throw error;
    return typeof constraint === 'string' && constraint !== ''
      ? constraint
      : errno;
  }
};

export const insertRow = (sql: SQL, table: string, row: Row) => {
  const columns = Object.keys(row);
  return sql.unsafe(
    `insert into ${table} (${columns.map((column) => `"${column}"`).join(', ')}) values (${columns.map((_, index) => `$${index + 1}`).join(', ')})`,
    Object.values(row),
  );
};

/** The scope of the open transaction, set as `withScope` sets it. */
export const setScope = (sql: SQL, scope: TenantScope) =>
  scopeTransaction(drizzle({ client: sql }), scope);

/**
 * Runs `body` as the web application's runtime role under one scope, then
 * returns to the migration owner with no scope.
 */
export const asRuntime = async <T>(
  sql: SQL,
  scope: TenantScope,
  body: () => Promise<T>,
): Promise<T> => {
  await sql.unsafe('set local role daisy_web');
  await setScope(sql, scope);
  const result = await body();
  // Not in a finally: a failed statement aborts the transaction, and a
  // cleanup that then fails too would hide the statement that failed.
  await setScope(sql, {});
  await sql.unsafe('reset role');
  return result;
};

const at = (minutes: number) =>
  new Date(Date.UTC(2027, 2, 6, 9, minutes)).toISOString();

/**
 * A sample tournament, written through the runtime role under scope. A
 * league's tournament with both shapes: a debate event that follows the
 * league's template, with preliminary rounds and a novice-division break,
 * sharing its first time slot with a speech event; and a rating-seeded
 * single elimination. It has a bye, a decided result and its correction, a
 * certification made before the correction, releases, a sanction and the
 * season rule. It is test support, never a seed.
 */
export const loadSampleTournament = async (sql: SQL) => {
  const fixture = new Fixture(sql);
  const id = () => createId();
  const owner = await fixture.user();
  const coach = await fixture.user();
  const staff = await fixture.user();
  const debaters = await Promise.all(
    Array.from({ length: 6 }, () => fixture.actor()),
  );
  const speakers = await Promise.all(
    Array.from({ length: 3 }, () => fixture.actor()),
  );
  const judgeActors = [await fixture.actor(), await fixture.actor()];
  const ids = {
    owner,
    coach,
    staff,
    debaters,
    speakers,
    judgeActors,
    league: id(),
    school: id(),
    template: id(),
    ballotDefinition: id(),
    season: id(),
    lobby: id(),
    otherLobby: id(),
    slots: [id(), id(), id()] as const,
    debate: id(),
    speech: id(),
    knockout: id(),
    prelims: id(),
    noviceBreak: id(),
    speechStage: id(),
    knockoutStage: id(),
    round1: id(),
    round2: id(),
    noviceFinal: id(),
    speechRound: id(),
    knockoutRound: id(),
    pool: id(),
    wording: id(),
    teams: [id(), id(), id()] as const,
    speechEntries: [id(), id(), id()] as const,
    judges: [id(), id()] as const,
    draw1: id(),
    draw2: id(),
    speechDraw: id(),
    pairing: id(),
    bye: id(),
    section: id(),
    room: id(),
    sectionRoom: id(),
    round: '',
    staffGrant: id(),
    conflict: id(),
    commands: {
      publish: id(),
      decide: id(),
      bye: id(),
      certify: id(),
      correct: id(),
      held: id(),
    },
    decided: id(),
    byeResult: id(),
    correction: id(),
    certification: id(),
    sanction: id(),
  };
  const write = (table: string, row: Row) => insertRow(sql, table, row);
  const command = (commandId: string, type: string, aggregateId: string) =>
    write('action_history', {
      command_id: commandId,
      lobby_id: ids.lobby,
      actor_user_id: owner,
      authority: 'owner',
      aggregate_kind: 'lobby',
      aggregate_id: aggregateId,
      type,
      payload_digest: digest,
      result: {},
      resulting_version: 1,
      applied_at: at(0),
    });
  const ancestry = (eventId: string, tabRoundId: string) => ({
    lobby_id: ids.lobby,
    event_id: eventId,
    tab_round_id: tabRoundId,
  });

  await asRuntime(sql, { organizationId: ids.league }, async () => {
    await write('organizations', {
      id: ids.league,
      kind: 'league',
      name: 'Sample League',
      handle: `league-${ids.league}`,
      owner_user_id: owner,
    });
    for (const userId of [owner, staff])
      await write('memberships', {
        organization_id: ids.league,
        user_id: userId,
        status: 'active',
        joined_at: at(0),
      });
    await write('templates', {
      id: ids.template,
      organization_id: ids.league,
      name: 'League Policy',
      format_id: 'policy',
      format_version: 1,
    });
    await write('settings', {
      id: id(),
      scope_kind: 'template',
      organization_id: ids.league,
      template_id: ids.template,
      key: 'standings.tiebreaks',
      hold: 'enforced',
      value: { metrics: ['wins', 'total_points'], minimumGames: null },
    });
    await write('settings', {
      id: id(),
      scope_kind: 'organization',
      organization_id: ids.league,
      key: 'conflict.handling',
      hold: 'default',
      value: { value: 'second_confirms' },
    });
    await write('ballot_definitions', {
      id: ids.ballotDefinition,
      organization_id: ids.league,
      name: 'Speech ballot',
      current_version: 1,
    });
    await write('ballot_definition_versions', {
      ballot_definition_id: ids.ballotDefinition,
      version: 1,
      organization_id: ids.league,
      definition: { outcome: 'ranking' },
    });
    await write('seasons', {
      id: ids.season,
      organization_id: ids.league,
      name: 'Sample season',
      starts_at: at(0),
      status: 'active',
    });
    await write('season_standing_rules', {
      season_id: ids.season,
      organization_id: ids.league,
      counting: 'sanction',
      rule: { points: 'wins' },
    });
  });

  await asRuntime(sql, { organizationId: ids.school }, async () => {
    await write('organizations', {
      id: ids.school,
      kind: 'school',
      name: 'Sample School',
      handle: `school-${ids.school}`,
      owner_user_id: coach,
    });
    await write('memberships', {
      organization_id: ids.school,
      user_id: coach,
      status: 'active',
      joined_at: at(0),
    });
  });

  await asRuntime(sql, { lobbyId: ids.otherLobby }, async () => {
    await write('lobbies', {
      id: ids.otherLobby,
      kind: 'tournament',
      owner_user_id: owner,
      name: 'Another tournament',
      handle: `other-${ids.otherLobby}`,
    });
    await write('tournaments', { lobby_id: ids.otherLobby });
  });

  await asRuntime(sql, { lobbyId: ids.lobby }, async () => {
    await write('lobbies', {
      id: ids.lobby,
      kind: 'tournament',
      owner_organization_id: ids.league,
      name: 'Sample Invitational',
      handle: `sample-${ids.lobby}`,
    });
    await write('tournaments', {
      lobby_id: ids.lobby,
      status: 'running',
      link_hash: digest,
    });
    await write('settings', {
      id: id(),
      scope_kind: 'lobby',
      lobby_id: ids.lobby,
      key: 'audience.posting',
      hold: 'default',
      value: { participants: 'at_once' },
    });
    await write('grants', {
      id: ids.staffGrant,
      role_id: 'lih2kkdou2a93bd7f8tgciko',
      user_id: staff,
      scope_kind: 'lobby',
      lobby_id: ids.lobby,
      granted_by_user_id: owner,
      granted_at: at(0),
    });
    for (const [index, slot] of ids.slots.entries())
      await write('time_slots', {
        id: slot,
        lobby_id: ids.lobby,
        name: `Slot ${index + 1}`,
        starts_at: at(60 * index),
      });
    await write('events', {
      id: ids.debate,
      lobby_id: ids.lobby,
      name: 'Varsity Policy',
      label: 'VP',
      format_id: 'policy',
      format_version: 1,
      template_id: ids.template,
      entry_kind: 'team',
      team_size: 2,
    });
    await write('events', {
      id: ids.speech,
      lobby_id: ids.lobby,
      name: 'Impromptu',
      format_id: 'freestyle',
      format_version: 1,
      ballot_definition_id: ids.ballotDefinition,
      ballot_definition_version: 1,
      entry_kind: 'person',
    });
    await write('events', {
      id: ids.knockout,
      lobby_id: ids.lobby,
      name: 'Open Knockout',
      format_id: 'value',
      format_version: 1,
      entry_kind: 'person',
    });
    await write('settings', {
      id: id(),
      scope_kind: 'event',
      lobby_id: ids.lobby,
      event_id: ids.debate,
      key: 'entry.divisions',
      hold: 'default',
      value: { items: [{ key: 'novice', label: 'Novice' }] },
    });
    const stage = (
      stageId: string,
      eventId: string,
      kind: string,
      sequence: number,
      division: string | null = null,
    ) =>
      write('stages', {
        id: stageId,
        lobby_id: ids.lobby,
        event_id: eventId,
        kind,
        sequence,
        division,
        place: 'online',
        timing: 'live',
      });
    await stage(ids.prelims, ids.debate, 'preliminary', 1);
    await stage(ids.noviceBreak, ids.debate, 'elimination', 2, 'novice');
    await stage(ids.speechStage, ids.speech, 'preliminary', 1);
    await stage(ids.knockoutStage, ids.knockout, 'elimination', 1);
    await write('resolution_pools', {
      id: ids.pool,
      lobby_id: ids.lobby,
      name: 'Tournament resolutions',
    });
    await write('pool_resolutions', {
      id: ids.wording,
      pool_id: ids.pool,
      lobby_id: ids.lobby,
      text: 'This house would abolish the sample.',
    });
    const tabRound = (
      tabRoundId: string,
      eventId: string,
      stageId: string,
      number: number,
      slot: string | null,
      rest: Row = {},
    ) =>
      write('tab_rounds', {
        id: tabRoundId,
        lobby_id: ids.lobby,
        event_id: eventId,
        stage_id: stageId,
        number,
        time_slot_id: slot,
        ...rest,
      });
    await tabRound(ids.round1, ids.debate, ids.prelims, 1, ids.slots[0], {
      resolution_pool_id: ids.pool,
      pool_resolution_id: ids.wording,
      resolution_released_at: at(5),
    });
    await tabRound(ids.round2, ids.debate, ids.prelims, 2, ids.slots[1]);
    await tabRound(ids.noviceFinal, ids.debate, ids.noviceBreak, 1, null, {
      name: 'Novice final',
    });
    await tabRound(ids.speechRound, ids.speech, ids.speechStage, 1, ids.slots[0]);
    await tabRound(ids.knockoutRound, ids.knockout, ids.knockoutStage, 1, ids.slots[2], {
      name: 'Quarterfinals',
    });
    for (const [index, entryId] of ids.teams.entries()) {
      await write('entries', {
        id: entryId,
        lobby_id: ids.lobby,
        event_id: ids.debate,
        name: `Team ${index + 1}`,
        status: 'accepted',
        division: index === 0 ? null : 'novice',
        responsible_kind: 'school',
        school_organization_id: ids.school,
      });
      for (const actorId of debaters.slice(index * 2, index * 2 + 2))
        await write('entry_members', {
          entry_id: entryId,
          actor_id: actorId,
          event_id: ids.debate,
          lobby_id: ids.lobby,
        });
    }
    for (const [index, entryId] of ids.speechEntries.entries()) {
      await write('entries', {
        id: entryId,
        lobby_id: ids.lobby,
        event_id: ids.speech,
        name: `Speaker ${index + 1}`,
        status: 'accepted',
        seed: index + 1,
        responsible_kind: 'self',
      });
      await write('entry_members', {
        entry_id: entryId,
        actor_id: speakers[index],
        event_id: ids.speech,
        lobby_id: ids.lobby,
      });
    }
    for (const [index, judgeId] of ids.judges.entries()) {
      await write('tournament_judges', {
        id: judgeId,
        lobby_id: ids.lobby,
        actor_id: judgeActors[index],
        status: 'accepted',
        chair_qualified: index === 0,
      });
      for (const slot of ids.slots)
        await write('judge_availability', {
          tournament_judge_id: judgeId,
          time_slot_id: slot,
          lobby_id: ids.lobby,
          available: true,
        });
    }
    await write('judge_events', {
      tournament_judge_id: ids.judges[1],
      event_id: ids.speech,
      lobby_id: ids.lobby,
    });
    await write('judge_strikes', {
      entry_id: ids.teams[2],
      tournament_judge_id: ids.judges[1],
      event_id: ids.debate,
      lobby_id: ids.lobby,
      source: 'entry',
    });

    // Round 1 of the debate: one pairing and a bye, drafted then published.
    await write('draws', {
      id: ids.draw1,
      ...ancestry(ids.debate, ids.round1),
      version: 1,
      method: 'computed',
      engine_version: 'sample-1',
      inputs: { seed: 'sample', settings: {} },
    });
    const fixtureRow = (
      fixtureId: string,
      eventId: string,
      tabRoundId: string,
      kind: string,
    ) =>
      write('fixtures', {
        id: fixtureId,
        ...ancestry(eventId, tabRoundId),
        kind,
      });
    await fixtureRow(ids.pairing, ids.debate, ids.round1, 'pairing');
    await fixtureRow(ids.bye, ids.debate, ids.round1, 'bye');
    const seat = (
      fixtureId: string,
      eventId: string,
      tabRoundId: string,
      entryId: string,
      position: number,
      side: string | null,
    ) =>
      write('fixture_entries', {
        fixture_id: fixtureId,
        ...ancestry(eventId, tabRoundId),
        entry_id: entryId,
        position,
        side,
      });
    await seat(ids.pairing, ids.debate, ids.round1, ids.teams[0], 0, 'affirmative');
    await seat(ids.pairing, ids.debate, ids.round1, ids.teams[1], 1, 'negative');
    await seat(ids.bye, ids.debate, ids.round1, ids.teams[2], 0, null);
    await write('fixture_judges', {
      fixture_id: ids.pairing,
      ...ancestry(ids.debate, ids.round1),
      tournament_judge_id: ids.judges[0],
    });
    for (const fixtureId of [ids.pairing, ids.bye])
      await write('draw_fixtures', {
        draw_id: ids.draw1,
        fixture_id: fixtureId,
        ...ancestry(ids.debate, ids.round1),
      });

    // The speech section shares the first time slot.
    await write('draws', {
      id: ids.speechDraw,
      ...ancestry(ids.speech, ids.speechRound),
      version: 1,
      method: 'typed',
      inputs: {},
    });
    await fixtureRow(ids.section, ids.speech, ids.speechRound, 'section');
    for (const [index, entryId] of ids.speechEntries.entries())
      await seat(ids.section, ids.speech, ids.speechRound, entryId, index, null);
    await write('fixture_judges', {
      fixture_id: ids.section,
      ...ancestry(ids.speech, ids.speechRound),
      tournament_judge_id: ids.judges[1],
    });
    await write('draw_fixtures', {
      draw_id: ids.speechDraw,
      fixture_id: ids.section,
      ...ancestry(ids.speech, ids.speechRound),
    });

    // Publishing gives each pairing or section its event Room; a bye has none.
    const eventRoom = (roomId: string, formatId: string) =>
      write('rooms', {
        id: roomId,
        lobby_id: ids.lobby,
        lobby_kind: 'tournament',
        host_actor_id: null,
        title: 'Event Room',
        topic: 'This house would abolish the sample.',
        visibility: 'unlisted',
        format_id: formatId,
        format_version: 1,
        competition_type: 'casual',
        config: validConfig,
        execution_plan: {},
        rules_snapshot: validRules,
        status: 'assembling',
      });
    await eventRoom(ids.room, 'policy');
    await eventRoom(ids.sectionRoom, 'freestyle');
    const publish = (fixtureId: string, roomId: string | null) =>
      sql.unsafe(
        `update fixtures set status = 'published', published_at = $2, room_id = $3 where id = $1`,
        [fixtureId, at(10), roomId],
      );
    await publish(ids.pairing, ids.room);
    await publish(ids.bye, null);
    await publish(ids.section, ids.sectionRoom);
    for (const drawId of [ids.draw1, ids.speechDraw])
      await sql.unsafe(
        `update draws set status = 'published', published_at = $2 where id = $1`,
        [drawId, at(10)],
      );
    await command(ids.commands.publish, 'publish-draw', ids.draw1);
    await write('releases', {
      id: id(),
      ...ancestry(ids.debate, ids.round1),
      thing: 'posting',
      audience: 'participants',
      cause: 'at_once',
      command_id: ids.commands.publish,
      opened_at: at(10),
    });

    // A conflict is recorded, and the command it held is confirmed.
    await write('conflicts', {
      id: ids.conflict,
      lobby_id: ids.lobby,
      user_id: staff,
      fixture_id: ids.pairing,
      basis: 'school_entry',
      handling: 'second_confirms',
      detected_at: at(20),
    });
    await write('pending_commands', {
      command_id: ids.commands.held,
      lobby_id: ids.lobby,
      proposer_user_id: staff,
      type: 'enter-result',
      payload: { fixtureId: ids.pairing },
      payload_digest: digest,
      expected: { fixture: 1 },
      conflict_id: ids.conflict,
      expires_at: at(600),
    });

    // Results: the pairing is decided, the bye is administrative.
    ids.round = createId();
    await write('rounds', {
      id: ids.round,
      room_id: ids.room,
      room_config_snapshot: validConfig,
      visibility: 'unlisted',
      resolution: 'This house would abolish the sample.',
      competition_type: 'casual',
      format_id: 'policy',
      format_version: 1,
      rules_snapshot: validRules,
      status: 'opening',
    });
    await command(ids.commands.decide, 'record-result', ids.pairing);
    await command(ids.commands.bye, 'enter-result', ids.bye);
    await write('results', {
      id: ids.decided,
      ...ancestry(ids.debate, ids.round1),
      fixture_id: ids.pairing,
      kind: 'decided',
      round_id: ids.round,
      command_id: ids.commands.decide,
      recorded_at: at(60),
    });
    const outcome = (resultId: string, won: readonly boolean[]) =>
      Promise.all(
        won.map((value, index) =>
          write('result_entries', {
            result_id: resultId,
            entry_id: ids.teams[index],
            fixture_id: ids.pairing,
            lobby_id: ids.lobby,
            won: value,
            ballots_won: value ? 1 : 0,
          }),
        ),
      );
    await outcome(ids.decided, [true, false]);
    for (const [index, actorId] of debaters.slice(0, 4).entries())
      await write('result_speakers', {
        result_id: ids.decided,
        actor_id: actorId,
        entry_id: ids.teams[index < 2 ? 0 : 1],
        lobby_id: ids.lobby,
        points: 27.5 + index,
        rank: index + 1,
      });
    await write('results', {
      id: ids.byeResult,
      ...ancestry(ids.debate, ids.round1),
      fixture_id: ids.bye,
      kind: 'administrative',
      administrative_reason: 'bye',
      command_id: ids.commands.bye,
      recorded_at: at(61),
    });
    await write('result_entries', {
      result_id: ids.byeResult,
      entry_id: ids.teams[2],
      fixture_id: ids.bye,
      lobby_id: ids.lobby,
      won: true,
    });

    // The host certifies both; a correction made afterwards is uncertified.
    await command(ids.commands.certify, 'certify-results', ids.debate);
    await write('certifications', {
      id: ids.certification,
      lobby_id: ids.lobby,
      event_id: ids.debate,
      scope: 'event',
      command_id: ids.commands.certify,
      certified_at: at(70),
    });
    for (const resultId of [ids.decided, ids.byeResult])
      await write('certification_results', {
        certification_id: ids.certification,
        result_id: resultId,
        event_id: ids.debate,
        lobby_id: ids.lobby,
      });
    await command(ids.commands.correct, 'correct-result', ids.pairing);
    await write('results', {
      id: ids.correction,
      ...ancestry(ids.debate, ids.round1),
      fixture_id: ids.pairing,
      kind: 'decided',
      round_id: ids.round,
      supersedes_result_id: ids.decided,
      correction_reason: 'The ballot was entered for the wrong side.',
      command_id: ids.commands.correct,
      recorded_at: at(80),
    });
    await outcome(ids.correction, [false, true]);

    // Round 2 is drawn from round 1's results.
    await write('draws', {
      id: ids.draw2,
      ...ancestry(ids.debate, ids.round2),
      version: 1,
      method: 'computed',
      engine_version: 'sample-1',
      inputs: { seed: 'sample', settings: {} },
    });
    for (const resultId of [ids.correction, ids.byeResult])
      await write('draw_result_inputs', {
        draw_id: ids.draw2,
        ...ancestry(ids.debate, ids.round2),
        result_id: resultId,
      });

    // The league says yes to its own tournament's event.
    await write('sanctions', {
      id: ids.sanction,
      organization_id: ids.league,
      lobby_id: ids.lobby,
      event_id: ids.debate,
      season_id: ids.season,
      template_id: ids.template,
      status: 'approved',
      decided_at: at(90),
    });
  });
  return ids;
};

export type SampleTournament = Awaited<ReturnType<typeof loadSampleTournament>>;

/** Daisy, organization number one, as the migrations seed it. */
export const daisy = { organization: daisyOrganizationId } as const;

export const columnsOf = async (sql: SQL, table: string) =>
  (
    (await sql.unsafe(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = $1 order by column_name`,
      [table],
    )) as Array<{ column_name: string }>
  ).map((row) => row.column_name);

/** An action history row in the sample's lobby, for a row that names its command. */
export const recordCommand = async (
  sql: SQL,
  ids: SampleTournament,
  rest: Row = {},
) => {
  const commandId = createId();
  await insertRow(sql, 'action_history', {
    command_id: commandId,
    lobby_id: ids.lobby,
    actor_user_id: ids.owner,
    authority: 'owner',
    aggregate_kind: 'lobby',
    aggregate_id: ids.lobby,
    type: 'sample-command',
    payload_digest: digest,
    result: {},
    resulting_version: 1,
    applied_at: at(100),
    ...rest,
  });
  return commandId;
};

/** A suite's body over the sample tournament, as the migration owner. */
export const withSample = (
  url: string,
  body: (sql: SQL, ids: SampleTournament) => Promise<void>,
) =>
  inRolledBackTransaction(url, async (sql) =>
    body(sql, await loadSampleTournament(sql)),
  );

export { at as sampleInstant };
