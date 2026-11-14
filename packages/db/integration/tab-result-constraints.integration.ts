import type { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, test } from 'riteway/bun';
import { daisyOrganizationId, publicLobbyId } from '../src/daisy-reference';
import { drizzle } from 'drizzle-orm/bun-sql';
import { listSeasonRecords } from '../src/season-record';
import { Fixture } from './constraint-helpers';
import { integrationSuite } from './suite.test-support';
import {
  columnsOf,
  insertRow,
  recordCommand,
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

const result = async (
  sql: SQL,
  ids: SampleTournament,
  rest: Record<string, unknown>,
) => {
  const id = createId();
  await insertRow(sql, 'results', {
    id,
    ...round1(ids),
    fixture_id: ids.bye,
    kind: 'administrative',
    administrative_reason: 'ruling',
    command_id: await recordCommand(sql, ids),
    recorded_at: at(120),
    ...rest,
  });
  return id;
};

/** TAB-4.12 */
test('a result is corrected only by a superseding result for the same fixture with a reason, and the earlier row stays as it was', async () => {
  await withSample(url, async (sql, ids) => {
    const row = async (id: string) =>
      (
        await sql.unsafe(
          'select to_jsonb(r) as row from results r where id = $1',
          [id],
        )
      )[0];
    const before = await row(ids.byeResult);
    const attempt = (rest: Record<string, unknown>) =>
      refusedBy(sql, () => result(sql, ids, rest));
    const refusals = {
      secondOriginal: await attempt({}),
      anotherFixture: await attempt({
        supersedes_result_id: ids.correction,
        correction_reason: 'Wrong fixture.',
      }),
      noReason: await attempt({ supersedes_result_id: ids.byeResult }),
      blankReason: await attempt({
        supersedes_result_id: ids.byeResult,
        correction_reason: '  ',
      }),
      reasonWithoutCorrection: await attempt({
        fixture_id: ids.section,
        event_id: ids.speech,
        tab_round_id: ids.speechRound,
        correction_reason: 'Nothing to correct.',
      }),
      alreadySuperseded: await attempt({
        fixture_id: ids.pairing,
        supersedes_result_id: ids.decided,
        correction_reason: 'A second correction of the same result.',
      }),
      decidedWithoutRound: await attempt({
        fixture_id: ids.section,
        event_id: ids.speech,
        tab_round_id: ids.speechRound,
        kind: 'decided',
        administrative_reason: null,
      }),
      administrativeWithoutReason: await attempt({
        fixture_id: ids.section,
        event_id: ids.speech,
        tab_round_id: ids.speechRound,
        administrative_reason: null,
      }),
      commandOfAnotherLobby: await refusedBy(sql, async () => {
        const commandId = await recordCommand(sql, ids, {
          lobby_id: ids.otherLobby,
        });
        await result(sql, ids, {
          fixture_id: ids.section,
          event_id: ids.speech,
          tab_round_id: ids.speechRound,
          command_id: commandId,
        });
      }),
    };
    const valid = await refusedBy(sql, () =>
      result(sql, ids, {
        supersedes_result_id: ids.byeResult,
        correction_reason: 'The bye was a forfeit.',
        administrative_reason: 'forfeit',
      }),
    );
    assert({
      given:
        'corrections for another fixture, without a reason and of a result already superseded, a second original, then a valid correction',
      should:
        'refuse the first four and other malformed results, accept the valid one, and leave the earlier row reading exactly as before',
      actual: {
        ...refusals,
        valid,
        earlierUnchanged:
          JSON.stringify(await row(ids.byeResult)) === JSON.stringify(before),
        history: (
          await sql.unsafe(
            'select count(*)::int as rows from results where fixture_id = $1',
            [ids.bye],
          )
        )[0],
      },
      expected: {
        secondOriginal: 'results_one_original_per_fixture',
        anotherFixture: 'results_supersedes_fk',
        noReason: 'results_correction_has_reason',
        blankReason: 'results_correction_has_reason',
        reasonWithoutCorrection: 'results_correction_has_reason',
        alreadySuperseded: 'results_superseded_once',
        decidedWithoutRound: 'results_decided_has_round',
        administrativeWithoutReason: 'results_administrative_reason_check',
        commandOfAnotherLobby: 'results_command_fk',
        valid: null,
        earlierUnchanged: true,
        history: { rows: 2 },
      },
    });
  });
});

test("what a result gave belongs to its fixture's entries", async () => {
  await withSample(url, async (sql, ids) => {
    const sectionResult = await result(sql, ids, {
      fixture_id: ids.section,
      event_id: ids.speech,
      tab_round_id: ids.speechRound,
    });
    assert({
      given:
        "a result entry for an entry that is not in the result's fixture, one naming another fixture, and a speaker under an entry the result does not hold",
      should: 'refuse each, and accept a ranking of the section',
      actual: {
        entryNotInFixture: await refusedBy(sql, () =>
          insertRow(sql, 'result_entries', {
            result_id: sectionResult,
            entry_id: ids.teams[0],
            fixture_id: ids.section,
            lobby_id: ids.lobby,
          }),
        ),
        anotherFixture: await refusedBy(sql, () =>
          insertRow(sql, 'result_entries', {
            result_id: sectionResult,
            entry_id: ids.teams[0],
            fixture_id: ids.pairing,
            lobby_id: ids.lobby,
          }),
        ),
        ranking: await refusedBy(sql, async () => {
          for (const [index, entryId] of ids.speechEntries.entries())
            await insertRow(sql, 'result_entries', {
              result_id: sectionResult,
              entry_id: entryId,
              fixture_id: ids.section,
              lobby_id: ids.lobby,
              rank: index + 1,
            });
        }),
        speakerWithoutEntry: await refusedBy(sql, () =>
          insertRow(sql, 'result_speakers', {
            result_id: sectionResult,
            actor_id: ids.debaters[0],
            entry_id: ids.teams[0],
            lobby_id: ids.lobby,
            points: 28,
          }),
        ),
        zeroRank: await refusedBy(sql, () =>
          insertRow(sql, 'result_speakers', {
            result_id: sectionResult,
            actor_id: ids.speakers[0],
            entry_id: ids.speechEntries[0],
            lobby_id: ids.lobby,
            rank: 0,
          }),
        ),
      },
      expected: {
        entryNotInFixture: 'result_entries_fixture_entry_fk',
        anotherFixture: 'result_entries_result_fk',
        ranking: null,
        speakerWithoutEntry: 'result_speakers_result_entry_fk',
        zeroRank: 'result_speakers_rank_positive',
      },
    });
  });
});

/** TAB-4.13 */
test('a certification pins the exact results it confirmed, so a later correction is uncertified until named again', async () => {
  await withSample(url, async (sql, ids) => {
    const certified = async () =>
      (
        (await sql.unsafe(
          `select cr.result_id from certification_results cr
           join certifications c on c.id = cr.certification_id
           where c.event_id = $1 order by c.certified_at, cr.result_id`,
          [ids.debate],
        )) as Array<{ result_id: string }>
      ).map((row) => row.result_id);
    const before = await certified();
    const second = createId();
    await insertRow(sql, 'certifications', {
      id: second,
      lobby_id: ids.lobby,
      event_id: ids.debate,
      scope: 'result',
      command_id: await recordCommand(sql, ids),
      certified_at: at(200),
    });
    const name = (resultId: string, rest: Record<string, unknown> = {}) =>
      refusedBy(sql, () =>
        insertRow(sql, 'certification_results', {
          certification_id: second,
          result_id: resultId,
          event_id: ids.debate,
          lobby_id: ids.lobby,
          ...rest,
        }),
      );
    const speechResult = await result(sql, ids, {
      fixture_id: ids.section,
      event_id: ids.speech,
      tab_round_id: ids.speechRound,
    });
    assert({
      given:
        'the event certified before a correction, then a new certification that names the correction',
      should:
        'list exactly the two results first confirmed, the correction among them only once the new certification names it, and refuse a result of another event',
      actual: {
        before: [...before].sort(),
        correctionCertifiedBefore: before.includes(ids.correction),
        named: await name(ids.correction),
        namedTwice: await name(ids.correction),
        resultOfAnotherEvent: await name(speechResult),
        correctionCertifiedAfter: (await certified()).includes(ids.correction),
        unknownScope: await refusedBy(sql, () =>
          insertRow(sql, 'certifications', {
            id: createId(),
            lobby_id: ids.lobby,
            event_id: ids.debate,
            scope: 'tournament',
            command_id: ids.commands.certify,
            certified_at: at(201),
          }),
        ),
      },
      expected: {
        before: [ids.decided, ids.byeResult].sort(),
        correctionCertifiedBefore: false,
        named: null,
        namedTwice: 'certification_results_pkey',
        resultOfAnotherEvent: 'certification_results_result_fk',
        correctionCertifiedAfter: true,
        unknownScope: 'certifications_scope_check',
      },
    });
  });
});

/** TAB-4.14 */
test('a league sanctions an event once, naming its own template and season and storing no terms', async () => {
  await withSample(url, async (sql, ids) => {
    const fixture = new Fixture(sql);
    const otherLeague = createId();
    const otherTemplate = createId();
    const otherSeason = createId();
    await insertRow(sql, 'organizations', {
      id: otherLeague,
      kind: 'league',
      name: 'Another League',
      handle: `league-${otherLeague}`,
      owner_user_id: await fixture.user(),
    });
    await insertRow(sql, 'templates', {
      id: otherTemplate,
      organization_id: otherLeague,
      name: 'Their Policy',
      format_id: 'policy',
      format_version: 1,
    });
    await insertRow(sql, 'seasons', {
      id: otherSeason,
      organization_id: otherLeague,
      name: 'Their season',
      starts_at: at(0),
      status: 'active',
    });
    const sanction = (rest: Record<string, unknown>) =>
      refusedBy(sql, () =>
        insertRow(sql, 'sanctions', {
          id: createId(),
          organization_id: ids.league,
          lobby_id: ids.lobby,
          event_id: ids.speech,
          season_id: ids.season,
          template_id: ids.template,
          status: 'requested',
          ...rest,
        }),
      );
    assert({
      given:
        "a league's second sanction of one event, another league's sanction of it, and sanctions naming a template or a season that is not the league's",
      should:
        "refuse the second, accept the other league's, refuse the borrowed template and season, and hold no terms",
      actual: {
        second: await sanction({ event_id: ids.debate }),
        anotherLeague: await sanction({
          event_id: ids.debate,
          organization_id: otherLeague,
          season_id: otherSeason,
          template_id: otherTemplate,
        }),
        templateNotItsOwn: await sanction({ template_id: otherTemplate }),
        seasonNotItsOwn: await sanction({ season_id: otherSeason }),
        bySchool: await sanction({ organization_id: ids.school }),
        eventOfAnotherLobby: await sanction({ lobby_id: ids.otherLobby }),
        decidedWhileRequested: await sanction({ decided_at: at(1) }),
        approvedWithoutInstant: await sanction({ status: 'approved' }),
        columns: await columnsOf(sql, 'sanctions'),
        ruleForAnothersSeason: await refusedBy(sql, () =>
          insertRow(sql, 'season_standing_rules', {
            season_id: otherSeason,
            organization_id: ids.league,
            counting: 'membership',
            rule: {},
          }),
        ),
      },
      expected: {
        second: 'sanctions_once_per_league',
        anotherLeague: null,
        templateNotItsOwn: 'sanctions_template_fk',
        seasonNotItsOwn: 'sanctions_season_fk',
        bySchool: 'sanctions_league_fk',
        eventOfAnotherLobby: 'sanctions_event_fk',
        decidedWhileRequested: 'sanctions_decided_consistent',
        approvedWithoutInstant: 'sanctions_decided_consistent',
        columns: [
          'created_at',
          'decided_at',
          'event_id',
          'id',
          'lobby_id',
          'organization_id',
          'organization_kind',
          'season_id',
          'status',
          'template_id',
          'updated_at',
          'version',
        ],
        ruleForAnothersSeason: 'season_standing_rules_season_fk',
      },
    });
  });
});

/** TAB-4.21 */
test('a release names a tab round and the cause that opened it, once per tab round, thing and audience', async () => {
  await withSample(url, async (sql, ids) => {
    const release = (rest: Record<string, unknown>) =>
      refusedBy(sql, () =>
        insertRow(sql, 'releases', {
          id: createId(),
          ...round1(ids),
          thing: 'decision',
          audience: 'competitors',
          cause: 'round_close',
          command_id: ids.commands.decide,
          opened_at: at(65),
          ...rest,
        }),
      );
    assert({
      given:
        'a release without a tab round, one without a cause, one caused by never, one to officials, and the same thing opened twice to one audience for a tab round',
      should:
        'refuse each, and accept the same thing for another audience and for another tab round',
      actual: {
        first: await release({}),
        again: await release({ cause: 'manual' }),
        anotherAudience: await release({ audience: 'responsible_adults' }),
        anotherTabRound: await release({ tab_round_id: ids.round2 }),
        noTabRound: await release({ tab_round_id: null }),
        noCause: await release({ cause: null, thing: 'scores' }),
        never: await release({ cause: 'never', thing: 'scores' }),
        officials: await release({ audience: 'officials', thing: 'scores' }),
        unknownThing: await release({ thing: 'ballot' }),
        tabRoundOfAnotherEvent: await release({
          tab_round_id: ids.speechRound,
          thing: 'video',
        }),
      },
      expected: {
        first: null,
        again: 'releases_once',
        anotherAudience: null,
        anotherTabRound: null,
        noTabRound: '23502',
        noCause: '23502',
        never: 'releases_cause_check',
        officials: 'releases_audience_check',
        unknownThing: 'releases_thing_check',
        tabRoundOfAnotherEvent: 'releases_tab_round_fk',
      },
    });
  });
});

test('ballot definitions are versioned and pinned, and screening never rewrites a ballot', async () => {
  await withSample(url, async (sql, ids) => {
    const fixture = new Fixture(sql);
    const judge = await fixture.seat(ids.round, 'judge');
    await fixture.freeze(ids.round);
    const ballot = createId();
    const writeBallot = (id: string, rest: Record<string, unknown> = {}) =>
      insertRow(sql, 'ballots', {
        id,
        judge_participant_id: judge.id,
        round_id: ids.round,
        freeze_revision: 1,
        rubric_version: 'speaker-10@2',
        winner: 'affirmative',
        scores: {},
        reason: 'A reason',
        submitted_at: at(50),
        ...rest,
      });
    await writeBallot(ballot, {
      ballot_definition_id: ids.ballotDefinition,
      ballot_definition_version: 1,
    });
    const before = (
      await sql.unsafe('select reason, updated_at from ballots where id = $1', [
        ballot,
      ])
    )[0];
    const screenedElsewhere = await refusedBy(sql, () =>
      insertRow(sql, 'ballot_screenings', {
        ballot_id: ballot,
        lobby_id: ids.otherLobby,
      }),
    );
    await insertRow(sql, 'ballot_screenings', {
      ballot_id: ballot,
      lobby_id: ids.lobby,
    });
    const movedElsewhere = await refusedBy(sql, () =>
      sql.unsafe(
        'update ballot_screenings set lobby_id = $2 where ballot_id = $1',
        [ballot, ids.otherLobby],
      ),
    );
    await sql.unsafe(
      `update ballot_screenings set status = 'held', screened_at = now(), released_text = '{"reason":"[held]"}'::jsonb where ballot_id = $1`,
      [ballot],
    );
    assert({
      given:
        'a ballot pinning a ballot definition version, screened and held; a definition pointing at a version that does not exist; and half a pin',
      should:
        'leave the ballot as written, and refuse the missing version and the half pin',
      actual: {
        screenedElsewhere,
        movedElsewhere,
        ballotUnchanged:
          JSON.stringify(
            (
              await sql.unsafe(
                'select reason, updated_at from ballots where id = $1',
                [ballot],
              )
            )[0],
          ) === JSON.stringify(before),
        clearedWithoutInstant: await refusedBy(sql, () =>
          sql.unsafe(
            `update ballot_screenings set status = 'pending' where ballot_id = $1`,
            [ballot],
          ),
        ),
        missingVersion: await refusedBy(sql, async () => {
          await sql.unsafe(
            'update ballot_definitions set current_version = 2 where id = $1',
            [ids.ballotDefinition],
          );
          await sql.unsafe('set constraints all immediate');
        }),
        halfPin: await refusedBy(sql, () =>
          sql.unsafe(
            'update events set ballot_definition_version = null where id = $1',
            [ids.speech],
          ),
        ),
        versionUnderAnotherKey: await refusedBy(sql, () =>
          insertRow(sql, 'ballot_definition_versions', {
            ballot_definition_id: ids.ballotDefinition,
            version: 2,
            lobby_id: ids.lobby,
            definition: {},
          }),
        ),
        secondVersion: await refusedBy(sql, () =>
          insertRow(sql, 'ballot_definition_versions', {
            ballot_definition_id: ids.ballotDefinition,
            version: 2,
            organization_id: ids.league,
            definition: { outcome: 'ranking', ranks: 6 },
          }),
        ),
      },
      expected: {
        ballotUnchanged: true,
        screenedElsewhere: 'ballot_screenings_lobby_is_ballots',
        movedElsewhere: 'ballot_screenings_lobby_is_ballots',
        clearedWithoutInstant: 'ballot_screenings_screened_consistent',
        missingVersion: 'ballot_definitions_current_version_fk',
        halfPin: 'events_ballot_definition_complete',
        versionUnderAnotherKey: 'ballot_definition_versions_lobby_fk',
        secondVersion: null,
      },
    });
  });
});

test('the altered tables keep Daisy as it was and admit a league beside it', async () => {
  await withSample(url, async (sql, ids) => {
    const fixture = new Fixture(sql);
    const formatId = await fixture.format();
    const actorId = await fixture.actor();
    const [member] = (await sql.unsafe(
      'select user_id from actors where id = $1',
      [actorId],
    )) as Array<{ user_id: string }>;
    const season = (rest: Record<string, unknown>) =>
      refusedBy(sql, () =>
        insertRow(sql, 'seasons', {
          id: createId(),
          name: 'A season',
          starts_at: at(0),
          status: 'active',
          ...rest,
        }),
      );
    const signature = (rest: Record<string, unknown>) =>
      refusedBy(sql, () =>
        insertRow(sql, 'agreement_signatures', {
          id: createId(),
          user_id: member!.user_id,
          agreement: 'tournament-recording-consent',
          version: '1',
          words: 'I agree to be recorded at this tournament.',
          signed_at: at(0),
          ...rest,
        }),
      );
    const rating = (ladder: string) =>
      refusedBy(sql, () =>
        insertRow(sql, 'ratings', {
          actor_id: actorId,
          season_id: ids.season,
          ladder,
          rating: 1500,
          deviation: 350,
          volatility: 0.06,
        }),
      );
    const leagueLadder = `ladder-${createId()}`;
    const leagueLobby = createId();
    await insertRow(sql, 'lobbies', {
      id: leagueLobby,
      kind: 'standing',
      owner_organization_id: ids.league,
      name: 'League lobby',
      handle: `lobby-${leagueLobby}`,
    });
    await insertRow(sql, 'ladders', {
      id: leagueLadder,
      lobby_id: leagueLobby,
      organization_id: ids.league,
      name: 'League ladder',
    });
    const unnamedSeason = await season({});
    const daisySeason = await season({ organization_id: daisyOrganizationId });
    assert({
      given:
        "a season written without an organization, a second active season for one organization, a league's ladder, a league's format, and a tournament recording consent",
      should:
        "refuse the unnamed season rather than make it Daisy's, keep one active season per organization, keep ratings on Daisy's ladders, and scope the consent to a lobby",
      actual: {
        unnamedSeason,
        daisySeason,
        seasonIsDaisys: (
          await sql.unsafe(
            `select count(*)::int as rows from seasons where organization_id = $1 and name = 'A season'`,
            [daisyOrganizationId],
          )
        )[0],
        // The league's active season from the sample is not a rating season.
        ratingSeasons: (await listSeasonRecords(drizzle({ client: sql }))).map(
          (record) => record.name,
        ),
        secondActiveForDaisy: await season({
          organization_id: daisyOrganizationId,
        }),
        secondActiveForLeague: await season({ organization_id: ids.league }),
        ratingOnDaisysLadder: await rating('policy'),
        ratingOnLeagueLadder: await rating(leagueLadder),
        ratingOnNoLadder: await refusedBy(sql, () =>
          sql
            .unsafe('alter table ratings drop constraint ratings_ladder_check')
            .then(() =>
              insertRow(sql, 'ratings', {
                actor_id: actorId,
                season_id: ids.season,
                ladder: 'unknown',
                rating: 1500,
                deviation: 350,
                volatility: 0.06,
              }),
            ),
        ),
        leagueFormat: await refusedBy(sql, () =>
          sql.unsafe('update formats set organization_id = $2 where id = $1', [
            formatId,
            ids.league,
          ]),
        ),
        formatWithTwoOwners: await refusedBy(sql, () =>
          sql.unsafe(
            'update formats set created_by_actor_id = $2 where id = $1',
            [formatId, actorId],
          ),
        ),
        consent: await signature({ lobby_id: ids.lobby }),
        consentTwice: await signature({ lobby_id: ids.lobby }),
        consentWithoutLobby: await signature({}),
        consentForAnotherLobby: await signature({ lobby_id: publicLobbyId }),
      },
      expected: {
        unnamedSeason: '23502',
        daisySeason: null,
        seasonIsDaisys: { rows: 1 },
        ratingSeasons: ['A season'],
        secondActiveForDaisy: 'seasons_single_active',
        secondActiveForLeague: 'seasons_single_active',
        ratingOnDaisysLadder: null,
        ratingOnLeagueLadder: 'ratings_ladder_check',
        ratingOnNoLadder: 'ratings_ladder_ladders_id_fkey',
        leagueFormat: null,
        formatWithTwoOwners: 'formats_one_owner_at_most',
        consent: null,
        consentTwice: 'agreement_signatures_once',
        consentWithoutLobby: 'agreement_signatures_scope_check',
        consentForAnotherLobby: null,
      },
    });
  });
});
