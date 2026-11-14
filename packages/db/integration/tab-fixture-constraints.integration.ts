import type { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, test } from 'riteway/bun';
import { publicLobbyId } from '../src/daisy-reference';
import { validConfig, validRules } from './round-fixtures';
import { integrationSuite } from './suite.test-support';
import {
  insertRow,
  refusedBy,
  sampleInstant as at,
  withSample,
  type SampleTournament,
} from './tab.test-support';

const { databaseUrl: url } = integrationSuite();

const round1 = (ids: SampleTournament) => ({
  lobby_id: ids.lobby,
  event_id: ids.debate,
  tab_round_id: ids.round1,
});

const eventRoom = async (
  sql: SQL,
  ids: SampleTournament,
  rest: Record<string, unknown> = {},
) => {
  const id = createId();
  await insertRow(sql, 'rooms', {
    id,
    lobby_id: ids.lobby,
    lobby_kind: 'tournament',
    host_actor_id: null,
    title: 'Event Room',
    topic: 'A topic',
    visibility: 'unlisted',
    format_id: 'policy',
    format_version: 1,
    competition_type: 'casual',
    config: validConfig,
    execution_plan: {},
    rules_snapshot: validRules,
    status: 'assembling',
    ...rest,
  });
  return id;
};

const draftFixture = async (
  sql: SQL,
  ids: SampleTournament,
  kind = 'pairing',
) => {
  const id = createId();
  await insertRow(sql, 'fixtures', { id, ...round1(ids), kind });
  return id;
};

const publish = (sql: SQL, fixtureId: string, roomId: string | null) =>
  sql.unsafe(
    `update fixtures set status = 'published', published_at = $2, room_id = $3 where id = $1`,
    [fixtureId, at(15), roomId],
  );

const withdraw = (sql: SQL, fixtureId: string) =>
  sql.unsafe(
    `update fixtures set status = 'withdrawn', withdrawn_at = $2 where id = $1`,
    [fixtureId, at(16)],
  );

/** TAB-4.10 */
test('a published draw is fixed, with the fixtures it holds and the results it was computed from', async () => {
  await withSample(url, async (sql, ids) => {
    const extra = await draftFixture(sql, ids);
    assert({
      given:
        'a published draw whose row, fixture list and result inputs are changed, and a draft draw computed from two results',
      should:
        'refuse every change to the published draw and list the results of the draft one',
      actual: {
        row: await refusedBy(sql, () =>
          sql.unsafe(`update draws set inputs = '{}'::jsonb where id = $1`, [
            ids.draw1,
          ]),
        ),
        unpublished: await refusedBy(sql, () =>
          sql.unsafe(
            `update draws set status = 'draft', published_at = null where id = $1`,
            [ids.draw1],
          ),
        ),
        deleted: await refusedBy(sql, () =>
          sql.unsafe('delete from draws where id = $1', [ids.draw1]),
        ),
        fixtureAdded: await refusedBy(sql, () =>
          insertRow(sql, 'draw_fixtures', {
            draw_id: ids.draw1,
            fixture_id: extra,
            ...round1(ids),
          }),
        ),
        fixtureRemoved: await refusedBy(sql, () =>
          sql.unsafe('delete from draw_fixtures where draw_id = $1', [
            ids.draw1,
          ]),
        ),
        inputAdded: await refusedBy(sql, () =>
          insertRow(sql, 'draw_result_inputs', {
            draw_id: ids.draw1,
            ...round1(ids),
            result_id: ids.byeResult,
          }),
        ),
        computedFrom: (
          (await sql.unsafe(
            'select result_id from draw_result_inputs where draw_id = $1',
            [ids.draw2],
          )) as Array<{ result_id: string }>
        )
          .map((row) => row.result_id)
          .sort(),
        usedTheResult: (
          (await sql.unsafe(
            'select draw_id from draw_result_inputs where result_id = $1',
            [ids.correction],
          )) as Array<{ draw_id: string }>
        ).map((row) => row.draw_id),
        secondVersionOne: await refusedBy(sql, () =>
          insertRow(sql, 'draws', {
            id: createId(),
            ...round1(ids),
            version: 1,
            method: 'typed',
            inputs: {},
          }),
        ),
        computedWithoutEngine: await refusedBy(sql, () =>
          insertRow(sql, 'draws', {
            id: createId(),
            ...round1(ids),
            version: 2,
            method: 'computed',
            inputs: {},
          }),
        ),
        draftDrawStillEditable: await refusedBy(sql, () =>
          sql.unsafe(
            `update draws set inputs = '{"seed":"again"}'::jsonb where id = $1`,
            [ids.draw2],
          ),
        ),
      },
      expected: {
        row: 'draws_published_immutable',
        unpublished: 'draws_published_immutable',
        deleted: 'draws_published_immutable',
        fixtureAdded: 'draw_fixtures_published_immutable',
        fixtureRemoved: 'draw_fixtures_published_immutable',
        inputAdded: 'draw_result_inputs_published_immutable',
        computedFrom: [ids.correction, ids.byeResult].sort(),
        usedTheResult: [ids.draw2],
        secondVersionOne: 'draws_version_unique',
        computedWithoutEngine: 'draws_engine_when_computed',
        draftDrawStillEditable: null,
      },
    });
  });
});

/** TAB-4.11 */
test('a Room sits in one lobby, with a host person exactly when that lobby is standing, and is casual in a tournament', async () => {
  await withSample(url, async (sql, ids) => {
    const room = (rest: Record<string, unknown>) =>
      refusedBy(sql, () => eventRoom(sql, ids, rest));
    assert({
      given:
        'Rooms in no lobby, with a host in a tournament lobby, without one in a standing lobby, claiming the wrong kind for their lobby, and ranked in a tournament lobby',
      should:
        'refuse each; a Room written without naming a lobby sits in the public one',
      actual: {
        noLobby: await room({ lobby_id: null }),
        hostInTournament: await room({ host_actor_id: ids.debaters[0] }),
        hostlessInStanding: await room({
          lobby_id: publicLobbyId,
          lobby_kind: 'standing',
        }),
        kindNotItsLobbys: await room({
          lobby_kind: 'standing',
          host_actor_id: ids.debaters[0],
        }),
        rankedInTournament: await room({ competition_type: 'ranked' }),
        byDefault: await (async () => {
          const id = createId();
          await sql.unsafe(
            `insert into rooms (id, host_actor_id, title, topic, visibility, format_id, format_version, competition_type, config, execution_plan, rules_snapshot, status)
             values ($1, $2, 'A Room', 'A topic', 'public', 'policy', 1, 'casual', $3, '{}'::jsonb, $4, 'assembling')`,
            [id, ids.debaters[0], validConfig, validRules],
          );
          return (
            await sql.unsafe(
              'select lobby_id, lobby_kind, template_id from rooms where id = $1',
              [id],
            )
          )[0];
        })(),
        containers: (
          (await sql.unsafe(
            `select distinct t.relname as parent from pg_constraint c
             join pg_class t on t.oid = c.confrelid
             where c.conrelid = 'rooms'::regclass and c.contype = 'f'
               and t.relname in ('lobbies', 'tournaments', 'events', 'organizations', 'fixtures', 'tab_rounds')`,
          )) as Array<{ parent: string }>
        ).map((row) => row.parent),
      },
      expected: {
        noLobby: '23502',
        hostInTournament: 'rooms_host_by_lobby_kind',
        hostlessInStanding: 'rooms_host_by_lobby_kind',
        kindNotItsLobbys: 'rooms_lobby_fk',
        rankedInTournament: 'rooms_event_is_casual',
        byDefault: {
          lobby_id: publicLobbyId,
          lobby_kind: 'standing',
          template_id: null,
        },
        containers: ['lobbies'],
      },
    });
  });
});

/** TAB-4.26 */
test('a fixture is one row for life: in every draw version, with its entries fixed once published, moving only forward', async () => {
  await withSample(url, async (sql, ids) => {
    // A second version of round 1's draw keeps the pairing.
    const version2 = createId();
    await insertRow(sql, 'draws', {
      id: version2,
      ...round1(ids),
      version: 2,
      based_on_draw_id: ids.draw1,
      method: 'typed',
      inputs: {},
    });
    await insertRow(sql, 'draw_fixtures', {
      draw_id: version2,
      fixture_id: ids.pairing,
      ...round1(ids),
    });
    const draft = await draftFixture(sql, ids);
    assert({
      given:
        "a pairing held by two draw versions, a fixture put in another tab round's draw, and a published fixture whose entries, sides, status and row are changed",
      should: 'keep one fixture row with two memberships, and refuse the rest',
      actual: {
        oneRow: (
          await sql.unsafe(
            `select (select count(*)::int from fixtures where id = $1) as fixtures,
               (select count(*)::int from draw_fixtures where fixture_id = $1) as versions`,
            [ids.pairing],
          )
        )[0],
        inAnotherTabRoundsDraw: await refusedBy(sql, () =>
          insertRow(sql, 'draw_fixtures', {
            draw_id: ids.draw2,
            fixture_id: ids.pairing,
            lobby_id: ids.lobby,
            event_id: ids.debate,
            tab_round_id: ids.round2,
          }),
        ),
        copyFollowsStatus: (
          (await sql.unsafe(
            'select distinct fixture_status from fixture_entries where fixture_id = $1',
            [ids.pairing],
          )) as Array<{ fixture_status: string }>
        ).map((row) => row.fixture_status),
        sideChanged: await refusedBy(sql, () =>
          sql.unsafe(
            `update fixture_entries set side = 'negative' where fixture_id = $1 and entry_id = $2`,
            [ids.pairing, ids.teams[0]],
          ),
        ),
        positionChanged: await refusedBy(sql, () =>
          sql.unsafe(
            'update fixture_entries set position = 5 where fixture_id = $1 and entry_id = $2',
            [ids.pairing, ids.teams[0]],
          ),
        ),
        entryRemoved: await refusedBy(sql, () =>
          sql.unsafe('delete from fixture_entries where fixture_id = $1', [
            ids.pairing,
          ]),
        ),
        entryAdded: await refusedBy(sql, () =>
          insertRow(sql, 'fixture_entries', {
            fixture_id: ids.bye,
            ...round1(ids),
            entry_id: ids.teams[0],
            position: 1,
            fixture_status: 'published',
          }),
        ),
        entryAddedAsDraft: await refusedBy(sql, () =>
          insertRow(sql, 'fixture_entries', {
            fixture_id: ids.bye,
            ...round1(ids),
            entry_id: ids.teams[0],
            position: 1,
          }),
        ),
        copyWrittenDirectly: await refusedBy(sql, () =>
          sql.unsafe(
            `update fixture_entries set fixture_status = 'draft' where fixture_id = $1`,
            [ids.pairing],
          ),
        ),
        entryOfAnotherEvent: await refusedBy(sql, () =>
          insertRow(sql, 'fixture_entries', {
            fixture_id: draft,
            ...round1(ids),
            entry_id: ids.speechEntries[0],
            position: 0,
          }),
        ),
        backToDraft: await refusedBy(sql, () =>
          sql.unsafe(
            `update fixtures set status = 'draft', published_at = null, room_id = null where id = $1`,
            [ids.pairing],
          ),
        ),
        movedTabRound: await refusedBy(sql, () =>
          sql.unsafe('update fixtures set tab_round_id = $2 where id = $1', [
            ids.section,
            ids.round2,
          ]),
        ),
        kindChanged: await refusedBy(sql, () =>
          sql.unsafe(`update fixtures set kind = 'section' where id = $1`, [
            ids.pairing,
          ]),
        ),
        deleted: await refusedBy(sql, () =>
          sql.unsafe('delete from fixtures where id = $1', [ids.bye]),
        ),
        draftDeleted: await refusedBy(sql, () =>
          sql.unsafe('delete from fixtures where id = $1', [draft]),
        ),
        judgeSwappedAfterPublishing: await refusedBy(sql, async () => {
          await sql.unsafe('delete from fixture_judges where fixture_id = $1', [
            ids.section,
          ]);
          await insertRow(sql, 'fixture_judges', {
            fixture_id: ids.section,
            lobby_id: ids.lobby,
            event_id: ids.speech,
            tab_round_id: ids.speechRound,
            tournament_judge_id: ids.judges[1],
            fixture_status: 'published',
          });
        }),
      },
      expected: {
        oneRow: { fixtures: 1, versions: 2 },
        inAnotherTabRoundsDraw: 'draw_fixtures_fixture_fk',
        copyFollowsStatus: ['published'],
        sideChanged: 'fixture_entries_fixed_once_published',
        positionChanged: 'fixture_entries_fixed_once_published',
        entryRemoved: 'fixture_entries_fixed_once_published',
        entryAdded: 'fixture_entries_fixed_once_published',
        entryAddedAsDraft: 'fixture_entries_fixture_status_fk',
        copyWrittenDirectly: 'fixture_entries_fixture_status_fk',
        entryOfAnotherEvent: 'fixture_entries_entry_fk',
        backToDraft: 'fixtures_status_forward_only',
        movedTabRound: 'fixtures_published_identity_immutable',
        kindChanged: 'fixtures_published_identity_immutable',
        deleted: 'fixtures_published_never_deleted',
        draftDeleted: null,
        judgeSwappedAfterPublishing: null,
      },
    });
  });
});

test('a fixture has a Room of its own lobby exactly when it is published and not a bye', async () => {
  await withSample(url, async (sql, ids) => {
    const pairing = await draftFixture(sql, ids);
    const bye = await draftFixture(sql, ids, 'bye');
    const room = await eventRoom(sql, ids);
    const [host] = (await sql.unsafe('select id from actors where id = $1', [
      ids.debaters[0],
    ])) as Array<{ id: string }>;
    const publicRoom = await (async () => {
      const id = createId();
      await insertRow(sql, 'rooms', {
        id,
        host_actor_id: host!.id,
        title: 'A public Room',
        topic: 'A topic',
        visibility: 'public',
        format_id: 'policy',
        format_version: 1,
        competition_type: 'casual',
        config: validConfig,
        execution_plan: {},
        rules_snapshot: validRules,
        status: 'assembling',
      });
      return id;
    })();
    assert({
      given:
        'a pairing published with no Room, with a Room of the public lobby and with a Room another fixture has; a draft given a Room; and a bye published with one',
      should:
        'refuse each, and accept a pairing with its own Room and a bye with none',
      actual: {
        publishedWithoutRoom: await refusedBy(sql, () =>
          publish(sql, pairing, null),
        ),
        roomOfAnotherLobby: await refusedBy(sql, () =>
          publish(sql, pairing, publicRoom),
        ),
        roomOfAnotherFixture: await refusedBy(sql, () =>
          publish(sql, pairing, ids.room),
        ),
        draftWithRoom: await refusedBy(sql, () =>
          sql.unsafe('update fixtures set room_id = $2 where id = $1', [
            pairing,
            room,
          ]),
        ),
        byeWithRoom: await refusedBy(sql, () => publish(sql, bye, room)),
        publishedWithoutInstant: await refusedBy(sql, () =>
          sql.unsafe(
            `update fixtures set status = 'published', room_id = $2 where id = $1`,
            [pairing, room],
          ),
        ),
        pairingWithRoom: await refusedBy(sql, () =>
          publish(sql, pairing, room),
        ),
        byeWithout: await refusedBy(sql, () => publish(sql, bye, null)),
        withdrawnKeepsRoom: await (async () => {
          await withdraw(sql, pairing);
          return (
            await sql.unsafe(
              'select status, room_id = $2 as keeps_room from fixtures where id = $1',
              [pairing, room],
            )
          )[0];
        })(),
      },
      expected: {
        publishedWithoutRoom: 'fixtures_room_when_published',
        roomOfAnotherLobby: 'fixtures_room_fk',
        roomOfAnotherFixture: 'fixtures_room_unique',
        draftWithRoom: 'fixtures_room_when_published',
        byeWithRoom: 'fixtures_room_when_published',
        publishedWithoutInstant: 'fixtures_lifecycle_instants',
        pairingWithRoom: null,
        byeWithout: null,
        withdrawnKeepsRoom: { status: 'withdrawn', keeps_room: true },
      },
    });
  });
});

/** TAB-4.27 */
test('a tab round has one live fixture per entry and per judge, results only on live fixtures, and no withdrawal of a fixture with a result', async () => {
  await withSample(url, async (sql, ids) => {
    const rematch = await draftFixture(sql, ids);
    await insertRow(sql, 'fixture_entries', {
      fixture_id: rematch,
      ...round1(ids),
      entry_id: ids.teams[0],
      position: 0,
    });
    const rejudged = await draftFixture(sql, ids);
    await insertRow(sql, 'fixture_judges', {
      fixture_id: rejudged,
      ...round1(ids),
      tournament_judge_id: ids.judges[0],
    });
    const draft = await draftFixture(sql, ids, 'bye');
    const result = async (fixtureId: string, rest: Record<string, unknown>) => {
      const commandId = createId();
      await insertRow(sql, 'action_history', {
        command_id: commandId,
        lobby_id: ids.lobby,
        actor_user_id: ids.owner,
        authority: 'owner',
        aggregate_kind: 'fixture',
        aggregate_id: fixtureId,
        type: 'enter-result',
        payload_digest: 'a'.repeat(64),
        result: {},
        resulting_version: 1,
        applied_at: at(100),
      });
      await insertRow(sql, 'results', {
        id: createId(),
        fixture_id: fixtureId,
        kind: 'administrative',
        administrative_reason: 'ruling',
        command_id: commandId,
        recorded_at: at(100),
        ...rest,
      });
    };
    const speech = {
      lobby_id: ids.lobby,
      event_id: ids.speech,
      tab_round_id: ids.speechRound,
    };
    assert({
      given:
        'in one tab round, a second fixture published for an entry already in a live one and for a judge already on one; a result on a draft fixture; and the withdrawal of a fixture with a result',
      should:
        'refuse each; a fixture with no result is withdrawn, takes no result afterwards, and frees its entries and judge',
      actual: {
        secondLiveForEntry: await refusedBy(sql, async () =>
          publish(sql, rematch, await eventRoom(sql, ids)),
        ),
        secondLiveForJudge: await refusedBy(sql, async () =>
          publish(sql, rejudged, await eventRoom(sql, ids)),
        ),
        resultOnDraft: await refusedBy(sql, () => result(draft, round1(ids))),
        withdrawnWithResult: await refusedBy(sql, () =>
          withdraw(sql, ids.pairing),
        ),
        withdrawnWithoutResult: await refusedBy(sql, () =>
          withdraw(sql, ids.section),
        ),
        resultOnWithdrawn: await refusedBy(sql, () =>
          result(ids.section, speech),
        ),
        freed: (
          (await sql.unsafe(
            `select distinct fixture_status from fixture_entries where fixture_id = $1
             union select distinct fixture_status from fixture_judges where fixture_id = $1`,
            [ids.section],
          )) as Array<{ fixture_status: string }>
        ).map((row) => row.fixture_status),
        replacementForTheWithdrawn: await refusedBy(sql, async () => {
          const replacement = createId();
          await insertRow(sql, 'fixtures', {
            id: replacement,
            ...speech,
            kind: 'section',
          });
          await insertRow(sql, 'fixture_entries', {
            fixture_id: replacement,
            ...speech,
            entry_id: ids.speechEntries[0],
            position: 0,
          });
          await insertRow(sql, 'fixture_judges', {
            fixture_id: replacement,
            ...speech,
            tournament_judge_id: ids.judges[1],
          });
          await publish(
            sql,
            replacement,
            await eventRoom(sql, ids, { format_id: 'freestyle' }),
          );
        }),
      },
      expected: {
        secondLiveForEntry: 'fixture_entries_one_live_per_tab_round',
        secondLiveForJudge: 'fixture_judges_one_live_per_tab_round',
        resultOnDraft: 'results_live_fixture_fk',
        withdrawnWithResult: 'results_live_fixture_fk',
        withdrawnWithoutResult: null,
        resultOnWithdrawn: 'results_live_fixture_fk',
        freed: ['withdrawn'],
        replacementForTheWithdrawn: null,
      },
    });
  });
});
