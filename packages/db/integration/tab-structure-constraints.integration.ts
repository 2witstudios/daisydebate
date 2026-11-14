import { createId } from '@paralleldrive/cuid2';
import { assert, test } from 'riteway/bun';
import { publicLobbyId } from '../src/daisy-reference';
import { validConfig, validRules } from './round-fixtures';
import { integrationSuite } from './suite.test-support';
import {
  columnsOf,
  daisy,
  insertRow,
  refusedBy,
  sampleInstant as at,
  withSample,
} from './tab.test-support';

const { databaseUrl: url } = integrationSuite();

/** TAB-4.7 */
test('a tournament is only the schedule extension of a tournament lobby', async () => {
  await withSample(url, async (sql, ids) => {
    assert({
      given:
        'a tournament row for a standing lobby, a second for one lobby, and the columns of the table',
      should:
        'refuse both, and hold nothing but the status, the minors declaration and the link hash',
      actual: {
        standing: await refusedBy(sql, () =>
          insertRow(sql, 'tournaments', { lobby_id: publicLobbyId }),
        ),
        twice: await refusedBy(sql, () =>
          insertRow(sql, 'tournaments', { lobby_id: ids.lobby }),
        ),
        badLinkHash: await refusedBy(sql, () =>
          sql.unsafe(
            `update tournaments set link_hash = 'link' where lobby_id = $1`,
            [ids.lobby],
          ),
        ),
        columns: await columnsOf(sql, 'tournaments'),
      },
      expected: {
        standing: 'tournaments_tournament_lobby_fk',
        twice: 'tournaments_pkey',
        badLinkHash: 'tournaments_link_hash_check',
        columns: [
          'admits_minors',
          'created_at',
          'link_hash',
          'lobby_id',
          'lobby_kind',
          'status',
          'updated_at',
        ],
      },
    });
  });
});

/** TAB-4.8 */
test('a lobby has one kind and one owner, a person or a league, and a ladder belongs to one standing lobby', async () => {
  await withSample(url, async (sql, ids) => {
    const lobby = (rest: Record<string, unknown>) =>
      refusedBy(sql, () =>
        insertRow(sql, 'lobbies', {
          id: createId(),
          kind: 'tournament',
          name: 'A lobby',
          handle: `lobby-${createId()}`,
          ...rest,
        }),
      );
    const ladder = (rest: Record<string, unknown>) =>
      refusedBy(sql, () =>
        insertRow(sql, 'ladders', {
          id: `ladder-${createId()}`,
          name: 'A ladder',
          ...rest,
        }),
      );
    assert({
      given:
        'lobbies with two owners, none, a school as owner and a person owning a standing lobby; and ladders on a tournament lobby and on a lobby another organization owns',
      should:
        'refuse each, with the seeded public lobby and its three ladders there after migrating',
      actual: {
        twoOwners: await lobby({
          owner_user_id: ids.owner,
          owner_organization_id: ids.league,
        }),
        noOwner: await lobby({}),
        schoolOwner: await lobby({ owner_organization_id: ids.school }),
        personOwnedStanding: await lobby({
          kind: 'standing',
          owner_user_id: ids.owner,
        }),
        unknownKind: await lobby({ kind: 'league', owner_user_id: ids.owner }),
        personOwnedTournament: await lobby({ owner_user_id: ids.owner }),
        secondStandingLobby: await lobby({
          kind: 'standing',
          owner_organization_id: ids.league,
        }),
        publicLobby: (
          await sql.unsafe(
            'select kind, owner_organization_id, handle from lobbies where id = $1',
            [publicLobbyId],
          )
        )[0],
        ladders: (
          (await sql.unsafe(
            'select id from ladders where lobby_id = $1 order by id',
            [publicLobbyId],
          )) as Array<{ id: string }>
        ).map((row) => row.id),
        ladderOnTournament: await ladder({
          lobby_id: ids.lobby,
          organization_id: ids.league,
        }),
        ladderOnAnothersLobby: await ladder({
          lobby_id: publicLobbyId,
          organization_id: ids.league,
        }),
      },
      expected: {
        twoOwners: 'lobbies_one_owner',
        noOwner: 'lobbies_one_owner',
        schoolOwner: 'lobbies_owner_league_fk',
        personOwnedStanding: 'lobbies_standing_is_organization_owned',
        unknownKind: 'lobbies_kind_check',
        personOwnedTournament: null,
        secondStandingLobby: null,
        publicLobby: {
          kind: 'standing',
          owner_organization_id: daisy.organization,
          handle: 'daisy',
        },
        ladders: ['freestyle', 'policy', 'value'],
        ladderOnTournament: 'ladders_standing_lobby_fk',
        ladderOnAnothersLobby: 'ladders_lobby_owner_fk',
      },
    });
  });
});

/** TAB-4.9 and TAB-4.20 */
test('an entry names one kind of responsible adult, a person is in one entry per event, and a division is optional', async () => {
  await withSample(url, async (sql, ids) => {
    const entry = (rest: Record<string, unknown>) =>
      refusedBy(sql, () =>
        insertRow(sql, 'entries', {
          id: createId(),
          lobby_id: ids.lobby,
          event_id: ids.debate,
          name: 'Another team',
          status: 'pending',
          ...rest,
        }),
      );
    const second = createId();
    await insertRow(sql, 'entries', {
      id: second,
      lobby_id: ids.lobby,
      event_id: ids.debate,
      name: 'A second team',
      status: 'pending',
      responsible_kind: 'self',
    });
    assert({
      given:
        'entries naming two kinds of responsible adult, none, and a league as the school; a second entry for one person in an event; and a division on a preliminary stage',
      should:
        'refuse each, while an entry and an elimination stage each store a division or none',
      actual: {
        twoKinds: await entry({
          responsible_kind: 'school',
          school_organization_id: ids.school,
          guardian_link_id: createId(),
        }),
        none: await entry({ responsible_kind: 'school' }),
        selfWithSchool: await entry({
          responsible_kind: 'self',
          school_organization_id: ids.school,
        }),
        leagueAsSchool: await entry({
          responsible_kind: 'school',
          school_organization_id: ids.league,
        }),
        entryOfAnotherLobby: await entry({
          lobby_id: ids.otherLobby,
          responsible_kind: 'self',
        }),
        secondEntryForOnePerson: await refusedBy(sql, () =>
          insertRow(sql, 'entry_members', {
            entry_id: second,
            actor_id: ids.debaters[0],
            event_id: ids.debate,
            lobby_id: ids.lobby,
          }),
        ),
        samePersonInAnotherEvent: await refusedBy(sql, () =>
          insertRow(sql, 'entry_members', {
            entry_id: ids.speechEntries[0],
            actor_id: ids.debaters[0],
            event_id: ids.speech,
            lobby_id: ids.lobby,
          }),
        ),
        entryDivisions: (
          (await sql.unsafe(
            'select division from entries where event_id = $1 order by name',
            [ids.debate],
          )) as Array<{ division: string | null }>
        ).map((row) => row.division),
        stageDivisions: await sql.unsafe(
          'select kind, division from stages where event_id = $1 order by sequence',
          [ids.debate],
        ),
        divisionOnPrelims: await refusedBy(sql, () =>
          sql.unsafe(`update stages set division = 'novice' where id = $1`, [
            ids.prelims,
          ]),
        ),
        windowWithoutTimes: await refusedBy(sql, () =>
          sql.unsafe(`update stages set timing = 'windowed' where id = $1`, [
            ids.prelims,
          ]),
        ),
      },
      expected: {
        twoKinds: 'entries_one_responsible_adult',
        none: 'entries_one_responsible_adult',
        selfWithSchool: 'entries_one_responsible_adult',
        leagueAsSchool: 'entries_school_fk',
        entryOfAnotherLobby: 'entries_event_fk',
        secondEntryForOnePerson: 'entry_members_one_entry_per_event',
        samePersonInAnotherEvent: null,
        entryDivisions: [null, null, 'novice', 'novice'],
        stageDivisions: [
          { kind: 'preliminary', division: null },
          { kind: 'elimination', division: 'novice' },
        ],
        divisionOnPrelims: 'stages_division_is_elimination',
        windowWithoutTimes: 'stages_window_check',
      },
    });
  });
});

/** TAB-4.17 */
test("a setting sits at one scope with that scope's key, once per scope and key, with a catalogue key and an object value", async () => {
  await withSample(url, async (sql, ids) => {
    const setting = (rest: Record<string, unknown>) =>
      refusedBy(sql, () =>
        insertRow(sql, 'settings', {
          id: createId(),
          key: 'entry.cap',
          hold: 'default',
          value: { perEvent: 40, perSchool: null },
          ...rest,
        }),
      );
    const scopes = {
      organization: { scope_kind: 'organization', organization_id: ids.league },
      template: {
        scope_kind: 'template',
        organization_id: ids.league,
        template_id: ids.template,
      },
      lobby: { scope_kind: 'lobby', lobby_id: ids.lobby },
      event: { scope_kind: 'event', lobby_id: ids.lobby, event_id: ids.debate },
    };
    const once: Record<string, Array<string | null>> = {};
    for (const [kind, scope] of Object.entries(scopes))
      once[kind] = [await setting(scope), await setting(scope)];
    assert({
      given:
        'each of the four scope patterns written twice, then every wrong combination of scope columns',
      should:
        'accept each scope once, refuse the second row for a scope and key, and refuse two scopes, none, and the wrong isolation key for a scope',
      actual: {
        once,
        twoScopes: await setting({
          scope_kind: 'organization',
          organization_id: ids.league,
          lobby_id: ids.lobby,
        }),
        noScope: await setting({ scope_kind: 'lobby' }),
        organizationWithTemplate: await setting({
          ...scopes.template,
          scope_kind: 'organization',
          key: 'entry.approval',
        }),
        templateWithoutItsOrganization: await setting({
          scope_kind: 'template',
          template_id: ids.template,
          lobby_id: ids.lobby,
        }),
        templateOfAnotherOrganization: await setting({
          scope_kind: 'template',
          template_id: ids.template,
          organization_id: ids.school,
          key: 'entry.approval',
        }),
        eventWithOrganizationKey: await setting({
          scope_kind: 'event',
          event_id: ids.debate,
          organization_id: ids.league,
        }),
        eventOfAnotherLobby: await setting({
          scope_kind: 'event',
          event_id: ids.debate,
          lobby_id: ids.otherLobby,
          key: 'entry.approval',
        }),
        lobbyWithEvent: await setting({
          ...scopes.event,
          scope_kind: 'lobby',
          key: 'entry.approval',
        }),
        unknownScope: await setting({
          scope_kind: 'stage',
          lobby_id: ids.lobby,
        }),
      },
      expected: {
        once: {
          organization: [null, 'settings_organization_key_unique'],
          template: [null, 'settings_template_key_unique'],
          lobby: [null, 'settings_lobby_key_unique'],
          event: [null, 'settings_event_key_unique'],
        },
        twoScopes: 'settings_one_tenant_key',
        noScope: 'settings_one_tenant_key',
        organizationWithTemplate: 'settings_scope_check',
        templateWithoutItsOrganization: 'settings_scope_check',
        templateOfAnotherOrganization: 'settings_template_fk',
        eventWithOrganizationKey: 'settings_scope_check',
        eventOfAnotherLobby: 'settings_event_fk',
        lobbyWithEvent: 'settings_scope_check',
        unknownScope: 'settings_scope_check',
      },
    });
    assert({
      given:
        'a key outside the catalogue, values that are not objects, an unknown hold, and enforced at each scope',
      should:
        'refuse the key, the values and the hold, and refuse enforced at event scope only',
      actual: {
        unknownKey: await setting({ ...scopes.lobby, key: 'room.colour' }),
        scalarValue: await setting({
          ...scopes.lobby,
          key: 'entry.approval',
          value: 'host',
        }),
        arrayValue: await refusedBy(sql, () =>
          sql.unsafe(
            `insert into settings (id, scope_kind, lobby_id, key, hold, value)
             values ($1, 'lobby', $2, 'entry.approval', 'default', '["host"]'::jsonb)`,
            [createId(), ids.lobby],
          ),
        ),
        unknownHold: await setting({
          ...scopes.lobby,
          key: 'entry.approval',
          hold: 'locked',
        }),
        enforcedAtLobby: await setting({
          ...scopes.lobby,
          key: 'entry.approval',
          hold: 'enforced',
        }),
        enforcedAtEvent: await setting({
          ...scopes.event,
          key: 'entry.approval',
          hold: 'enforced',
        }),
        hasVersion: (await columnsOf(sql, 'settings')).includes('version'),
      },
      expected: {
        unknownKey: 'settings_key_check',
        scalarValue: 'settings_value_is_object',
        arrayValue: 'settings_value_is_object',
        unknownHold: 'settings_hold_check',
        enforcedAtLobby: null,
        enforcedAtEvent: 'settings_event_hold_is_default',
        hasVersion: false,
      },
    });
  });
});

/** TAB-4.23 */
test('each settings scope carries a settings version apart from its own version', async () => {
  await withSample(url, async (sql, ids) => {
    const moved: Record<string, unknown> = {};
    for (const [table, id] of [
      ['organizations', ids.league],
      ['templates', ids.template],
      ['lobbies', ids.lobby],
      ['events', ids.debate],
    ] as const)
      moved[table] = (
        await sql.unsafe(
          `update ${table} set settings_version = settings_version + 1 where id = $1
           returning version, settings_version`,
          [id],
        )
      )[0];
    assert({
      given:
        'an organization, a template, a lobby and an event whose settings version is bumped, as the settings writer does on every set and clear',
      should:
        'move the settings version and leave the row version where it was',
      actual: {
        moved,
        zeroRefused: await refusedBy(sql, () =>
          sql.unsafe('update events set settings_version = 0 where id = $1', [
            ids.debate,
          ]),
        ),
        entriesVersion: (
          await sql.unsafe(
            'update events set entries_version = entries_version + 1 where id = $1 returning version, entries_version',
            [ids.debate],
          )
        )[0],
      },
      expected: {
        moved: {
          organizations: { version: 1, settings_version: 2 },
          templates: { version: 1, settings_version: 2 },
          lobbies: { version: 1, settings_version: 2 },
          events: { version: 1, settings_version: 2 },
        },
        zeroRefused: 'events_settings_version_positive',
        entriesVersion: { version: 1, entries_version: 2 },
      },
    });
  });
});

/** TAB-4.18 */
test('a template keeps its pins, is offered only by a standing lobby, and is followed only where the keys allow', async () => {
  await withSample(url, async (sql, ids) => {
    const [daisyPolicy] = (await sql.unsafe(
      `select id from templates where organization_id = $1 and format_id = 'policy'`,
      [daisy.organization],
    )) as Array<{ id: string }>;
    const host = (
      (await sql.unsafe('select id from actors where user_id = $1', [
        ids.owner,
      ])) as Array<{ id: string }>
    )[0];
    const hostActor =
      host?.id ??
      (await (async () => {
        const id = createId();
        await insertRow(sql, 'actors', {
          id,
          kind: 'human',
          user_id: ids.owner,
        });
        return id;
      })());
    const room = (rest: Record<string, unknown>) =>
      refusedBy(sql, () =>
        insertRow(sql, 'rooms', {
          id: createId(),
          host_actor_id: hostActor,
          title: 'A Room',
          topic: 'A topic',
          visibility: 'public',
          format_id: 'policy',
          format_version: 1,
          competition_type: 'casual',
          config: validConfig,
          execution_plan: {},
          rules_snapshot: validRules,
          status: 'assembling',
          ...rest,
        }),
      );
    assert({
      given:
        "a change to a template's format and to its ballot pin, a tournament lobby offering a template, an event following a template of another format, and a Room following a template its lobby does not offer",
      should:
        'refuse each, while a rename, a retirement, and a Room following a template its lobby offers are accepted',
      actual: {
        format: await refusedBy(sql, () =>
          sql.unsafe(`update templates set format_id = 'value' where id = $1`, [
            ids.template,
          ]),
        ),
        ballot: await refusedBy(sql, () =>
          sql.unsafe(
            'update templates set ballot_definition_id = $2, ballot_definition_version = 1 where id = $1',
            [ids.template, ids.ballotDefinition],
          ),
        ),
        halfBallotPin: await refusedBy(sql, () =>
          insertRow(sql, 'templates', {
            id: createId(),
            organization_id: ids.league,
            name: 'Half pinned',
            format_id: 'policy',
            format_version: 1,
            ballot_definition_id: ids.ballotDefinition,
          }),
        ),
        renamedAndRetired: await refusedBy(sql, () =>
          sql.unsafe(
            `update templates set name = 'League Policy 2027', retired_at = now(), version = version + 1 where id = $1`,
            [ids.template],
          ),
        ),
        sameNameTwice: await refusedBy(sql, () =>
          insertRow(sql, 'templates', {
            id: createId(),
            organization_id: ids.league,
            name: 'league policy 2027',
            format_id: 'policy',
            format_version: 1,
          }),
        ),
        tournamentOffers: await refusedBy(sql, () =>
          insertRow(sql, 'lobby_templates', {
            lobby_id: ids.lobby,
            template_id: ids.template,
          }),
        ),
        eventOfAnotherFormat: await refusedBy(sql, () =>
          insertRow(sql, 'events', {
            id: createId(),
            lobby_id: ids.lobby,
            name: 'Value under a policy template',
            format_id: 'value',
            format_version: 1,
            template_id: ids.template,
            entry_kind: 'person',
          }),
        ),
        roomFollowsUnoffered: await room({ template_id: ids.template }),
        roomFollowsOffered: await room({ template_id: daisyPolicy!.id }),
        seededOffer: (
          await sql.unsafe(
            'select count(*)::int as offered from lobby_templates where lobby_id = $1 and withdrawn_at is null',
            [publicLobbyId],
          )
        )[0],
      },
      expected: {
        format: 'templates_pins_immutable',
        ballot: 'templates_pins_immutable',
        halfBallotPin: 'templates_ballot_definition_complete',
        renamedAndRetired: null,
        sameNameTwice: 'templates_name_unique',
        tournamentOffers: 'lobby_templates_standing_lobby_fk',
        eventOfAnotherFormat: 'events_template_format_fk',
        roomFollowsUnoffered: 'rooms_offered_template_fk',
        roomFollowsOffered: null,
        seededOffer: { offered: 3 },
      },
    });
  });
});

/** TAB-4.19 */
test('a time slot belongs to one tournament lobby, holds only its tab rounds, and its version serialises writes into it', async () => {
  await withSample(url, async (sql, ids) => {
    const otherSlot = createId();
    await insertRow(sql, 'time_slots', {
      id: otherSlot,
      lobby_id: ids.otherLobby,
      name: 'Slot 1',
      starts_at: at(0),
    });
    const claim = async (version: number) =>
      (
        (await sql.unsafe(
          `with claimed as (
             update time_slots set version = version + 1 where id = $1 and version = $2 returning 1)
           select count(*)::int as rows from claimed`,
          [ids.slots[0], version],
        )) as Array<{ rows: number }>
      )[0]!.rows;
    assert({
      given:
        "a time slot in a standing lobby, a tab round placed in another lobby's slot, a second availability row for a judge and slot, and two writes that read the same slot version",
      should:
        'refuse the first three, and let only the first of the two writes find the version it read',
      actual: {
        slotInStandingLobby: await refusedBy(sql, () =>
          insertRow(sql, 'time_slots', {
            id: createId(),
            lobby_id: publicLobbyId,
            name: 'Evening',
            starts_at: at(0),
          }),
        ),
        sameNameTwice: await refusedBy(sql, () =>
          insertRow(sql, 'time_slots', {
            id: createId(),
            lobby_id: ids.lobby,
            name: 'slot 1',
            starts_at: at(0),
          }),
        ),
        tabRoundInAnothersSlot: await refusedBy(sql, () =>
          sql.unsafe('update tab_rounds set time_slot_id = $2 where id = $1', [
            ids.round2,
            otherSlot,
          ]),
        ),
        availabilityTwice: await refusedBy(sql, () =>
          insertRow(sql, 'judge_availability', {
            tournament_judge_id: ids.judges[0],
            time_slot_id: ids.slots[0],
            lobby_id: ids.lobby,
            available: false,
          }),
        ),
        availabilityInAnothersSlot: await refusedBy(sql, () =>
          insertRow(sql, 'judge_availability', {
            tournament_judge_id: ids.judges[0],
            time_slot_id: otherSlot,
            lobby_id: ids.lobby,
            available: true,
          }),
        ),
        twoWritesOnOneReading: [await claim(1), await claim(1)],
        unscheduledTabRound: (
          await sql.unsafe(
            'select time_slot_id from tab_rounds where id = $1',
            [ids.noviceFinal],
          )
        )[0],
      },
      expected: {
        slotInStandingLobby: 'time_slots_lobby_id_tournaments_lobby_id_fkey',
        sameNameTwice: 'time_slots_name_unique',
        tabRoundInAnothersSlot: 'tab_rounds_time_slot_fk',
        availabilityTwice: 'judge_availability_pkey',
        availabilityInAnothersSlot: 'judge_availability_time_slot_fk',
        twoWritesOnOneReading: [1, 0],
        unscheduledTabRound: { time_slot_id: null },
      },
    });
  });
});

/** TAB-4.25 */
test("a tournament judge carries a status, a chair qualification, its own lobby's events and strikes that say who made them", async () => {
  await withSample(url, async (sql, ids) => {
    const otherEvent = createId();
    await insertRow(sql, 'events', {
      id: otherEvent,
      lobby_id: ids.otherLobby,
      name: 'Elsewhere',
      format_id: 'policy',
      format_version: 1,
      entry_kind: 'person',
    });
    const strike = (source: string, entryId: string) =>
      refusedBy(sql, () =>
        insertRow(sql, 'judge_strikes', {
          entry_id: entryId,
          tournament_judge_id: ids.judges[0],
          event_id: ids.debate,
          lobby_id: ids.lobby,
          source,
        }),
      );
    assert({
      given:
        "the sample's judges, an event of another lobby listed for one, strikes of each source and one of an unknown source",
      should:
        "show status and chair qualification, refuse the other lobby's event and the unknown source, and tell an entry's strike from a declared conflict",
      actual: {
        judges: await sql.unsafe(
          'select status, chair_qualified from tournament_judges where lobby_id = $1 order by chair_qualified desc',
          [ids.lobby],
        ),
        eventOfAnotherLobby: await refusedBy(sql, () =>
          insertRow(sql, 'judge_events', {
            tournament_judge_id: ids.judges[0],
            event_id: otherEvent,
            lobby_id: ids.lobby,
          }),
        ),
        ownEvent: await refusedBy(sql, () =>
          insertRow(sql, 'judge_events', {
            tournament_judge_id: ids.judges[0],
            event_id: ids.debate,
            lobby_id: ids.lobby,
          }),
        ),
        sameActorTwice: await refusedBy(sql, () =>
          insertRow(sql, 'tournament_judges', {
            id: createId(),
            lobby_id: ids.lobby,
            actor_id: ids.judgeActors[0],
            status: 'invited',
          }),
        ),
        unknownStatus: await refusedBy(sql, () =>
          sql.unsafe(
            `update tournament_judges set status = 'benched' where id = $1`,
            [ids.judges[0]],
          ),
        ),
        declaredByJudge: await strike('judge', ids.teams[0]),
        declaredByTab: await strike('tab', ids.teams[1]),
        unknownSource: await strike('coach', ids.teams[2]),
        strikes: await sql.unsafe(
          `select source, count(*)::int as rows from judge_strikes where lobby_id = $1 group by source order by source`,
          [ids.lobby],
        ),
      },
      expected: {
        judges: [
          { status: 'accepted', chair_qualified: true },
          { status: 'accepted', chair_qualified: false },
        ],
        eventOfAnotherLobby: 'judge_events_event_fk',
        ownEvent: null,
        sameActorTwice: 'tournament_judges_actor_unique',
        unknownStatus: 'tournament_judges_status_check',
        declaredByJudge: null,
        declaredByTab: null,
        unknownSource: 'judge_strikes_source_check',
        strikes: [
          { source: 'entry', rows: 1 },
          { source: 'judge', rows: 1 },
          { source: 'tab', rows: 1 },
        ],
      },
    });
  });
});

test("a tab round's wording comes from its pool, and a pool's wording never changes", async () => {
  await withSample(url, async (sql, ids) => {
    const leaguePool = createId();
    await insertRow(sql, 'resolution_pools', {
      id: leaguePool,
      organization_id: ids.league,
      season_id: ids.season,
      name: 'Season resolutions',
    });
    assert({
      given:
        "a tab round naming a wording with no pool or from another pool, a wording rewritten, a pool with two owners, a lobby pool naming a season, and a wording whose key is not its pool's",
      should: 'refuse each, while retiring a wording is accepted',
      actual: {
        wordingWithoutPool: await refusedBy(sql, () =>
          sql.unsafe(
            'update tab_rounds set pool_resolution_id = $2 where id = $1',
            [ids.round2, ids.wording],
          ),
        ),
        wordingFromAnotherPool: await refusedBy(sql, () =>
          sql.unsafe(
            'update tab_rounds set resolution_pool_id = $2, pool_resolution_id = $3 where id = $1',
            [ids.round2, leaguePool, ids.wording],
          ),
        ),
        rewritten: await refusedBy(sql, () =>
          sql.unsafe(
            `update pool_resolutions set text = 'Another wording.' where id = $1`,
            [ids.wording],
          ),
        ),
        retired: await refusedBy(sql, () =>
          sql.unsafe(
            'update pool_resolutions set retired_at = now() where id = $1',
            [ids.wording],
          ),
        ),
        twoOwners: await refusedBy(sql, () =>
          insertRow(sql, 'resolution_pools', {
            id: createId(),
            organization_id: ids.league,
            lobby_id: ids.lobby,
            name: 'Shared',
          }),
        ),
        lobbyPoolWithSeason: await refusedBy(sql, () =>
          insertRow(sql, 'resolution_pools', {
            id: createId(),
            lobby_id: ids.lobby,
            season_id: ids.season,
            name: 'Seasonal',
          }),
        ),
        wordingUnderAnotherKey: await refusedBy(sql, () =>
          insertRow(sql, 'pool_resolutions', {
            id: createId(),
            pool_id: ids.pool,
            organization_id: ids.league,
            text: 'This house would mislabel a wording.',
          }),
        ),
      },
      expected: {
        wordingWithoutPool: 'tab_rounds_wording_from_pool',
        wordingFromAnotherPool: 'tab_rounds_pool_resolution_fk',
        rewritten: 'pool_resolutions_wording_immutable',
        retired: null,
        twoOwners: 'resolution_pools_one_tenant_key',
        lobbyPoolWithSeason: 'resolution_pools_season_is_organizations',
        wordingUnderAnotherKey: 'pool_resolutions_organization_pool_fk',
      },
    });
  });
});
