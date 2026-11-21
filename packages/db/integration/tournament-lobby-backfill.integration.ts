import { SQL } from 'bun';
import { afterAll } from 'bun:test';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { Fixture, rejectedBy } from './constraint-helpers';
import { validConfig } from './round-fixtures';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

setupRitewayBun();
const scratch = scratchDatabase(
  requireTestServices(process.env).databaseUrl,
  'tflobby',
);
const migration = '20261121082437_tournament_lobby_eligibility';
const validated = '20261121082457_tournament_lobby_eligibility_validated';

afterAll(() => scratch.drop());

test(
  'the tournament lobby migration preserves age policy, refuses ambiguity, and retries atomically',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < migration);
    const f = new Fixture(new SQL(scratch.url));
    try {
      const owner = await f.user();
      const host = await f.actor();
      const format = await f.format();
      const league = createId();
      await f.insert('organizations', {
        id: league,
        kind: 'league',
        owner_user_id: owner,
        name: 'Historic league',
        handle: createId(),
        league_division: 'open',
      });
      const other = createId();
      await f.insert('organizations', {
        id: other,
        kind: 'league',
        owner_user_id: owner,
        name: 'Other league',
        handle: createId(),
        league_division: 'open',
      });
      const standing = async (leagueId: string, ageRule: string) => {
        const id = createId();
        await f.insert('lobbies', {
          id,
          kind: 'standing',
          owner_organization_id: leagueId,
          name: 'Standing lobby',
          handle: createId(),
          age_rule: ageRule,
        });
        return id;
      };
      const matched = await standing(league, 'under-18');
      const ambiguous = await standing(league, 'under-18');
      const foreign = await standing(other, 'adults');
      const tournament = async (leagueId: string | null, youth = false) => {
        const id = createId();
        await f.insert('lobbies', {
          id,
          kind: 'tournament',
          name: 'Old tournament',
          handle: createId(),
          owner_organization_id: leagueId,
          owner_user_id: leagueId === null ? owner : null,
        });
        await f.insert('tournaments', { lobby_id: id }, 'lobby_id');
        if (youth)
          await f.insert('settings', {
            id: createId(),
            scope_kind: 'lobby',
            lobby_id: id,
            key: 'entry.age_division',
            hold: 'default',
            value: { value: 'youth' },
          });
        return id;
      };
      const youth = await tournament(league, true);
      const open = await tournament(league);
      const otherOpen = await tournament(league);
      const personal = await tournament(null, true);
      const tournamentRoom = (
        lobbyId: string,
        legacyYouth: boolean | null = null,
      ) =>
        f.room(host, format, {
          lobby_id: lobbyId,
          lobby_kind: 'tournament',
          host_actor_id: null,
          legacy_tournament_youth: legacyYouth,
          capture: { broadcast: null, recordingPolicy: 'off' },
        });
      const frozenOpen = await tournamentRoom(youth, false);
      const frozenYouth = await tournamentRoom(open, true);
      const classifiedAtUpgrade = await tournamentRoom(youth);
      const migrate = () => scratch.migrate((folder) => folder <= validated);
      const failure = await migrate().then(
        () => '',
        (error: unknown) => String(error),
      );
      const [rolledBack] = await f.sql`
        select (select count(*)::int from lobbies where owner_organization_id=${league}
          and kind='standing') as parents,
          (select count(*)::int from settings where key='entry.age_division') as settings
      `;
      assert({
        given:
          'two same-league standing lobbies with the same legacy age rule and no parent evidence',
        should:
          'report both candidate IDs and retain the prior schema and rows',
        actual: {
          ambiguous: failure.includes(
            'Tournament standing lobby selection is ambiguous',
          ),
          identifiesCandidates: [matched, ambiguous, youth].every((id) =>
            failure.includes(id),
          ),
          rolledBack,
        },
        expected: {
          ambiguous: true,
          identifiesCandidates: true,
          rolledBack: { parents: 2, settings: 2 },
        },
      });

      await f.sql`update lobbies set age_rule='anyone' where id=${ambiguous}`;
      await f.sql`alter table rooms add constraint fixture_reject_upgrade
        check (legacy_tournament_youth is distinct from true) not valid`;
      const interrupted = await rejectedBy(migrate);
      const [afterFailure] = await f.sql`
        select
          (select count(*)::int from lobbies where owner_organization_id=${league}
            and kind='standing' and age_rule='adults') as "mintedParents",
          (select count(*)::int from settings where key='entry.age_division') as settings,
          (select count(*)::int from information_schema.columns where table_schema='public'
            and table_name='lobbies' and column_name='standing_lobby_id') as "parentColumn"
      `;
      assert({
        given: 'the migration fails after creating a missing parent',
        should: 'roll back the minted parent, old settings and schema together',
        actual: { interrupted, afterFailure },
        expected: {
          interrupted: 'fixture_reject_upgrade',
          afterFailure: { mintedParents: 0, settings: 2, parentColumn: 0 },
        },
      });
      await f.sql`alter table rooms drop constraint fixture_reject_upgrade`;
      await migrate();
      const snapshot = () => f.sql<
        {
          id: string;
          age_rule: string | null;
          standing_lobby_id: string | null;
          owner_organization_id: string | null;
          parent_rule: string | null;
        }[]
      >`
        select lobby.id, lobby.age_rule, lobby.standing_lobby_id, parent.owner_organization_id,
          parent.age_rule as parent_rule
        from lobbies lobby left join lobbies parent on parent.id=lobby.standing_lobby_id
        where lobby.id in (${youth}, ${open}, ${otherOpen}, ${personal}) order by lobby.id
      `;
      const first = await snapshot();
      const byId = Object.fromEntries(
        first.map((row) => [String(row.id), row]),
      );
      const minted = String(byId[open]!.standing_lobby_id);
      await migrate();
      const afterRetry = await snapshot();
      const live = await tournamentRoom(youth);
      const [beforeEdit] =
        await f.sql`select public.daisy_room_is_youth(${live}) as youth`;
      const schoolMember = async (years: number) => {
        const userId = await f.user();
        await f.sql`insert into account_age(user_id,birth_month,version,recorded_at)
          values(${userId},to_char(now()-make_interval(years=>${years}), 'YYYY-MM'),1,now())`;
        return { userId, actorId: await f.actor(userId) };
      };
      const pupil = await schoolMember(15);
      const adultEntrant = await schoolMember(25);
      const enrollAtSchool = async (student: string) => {
        const coach = await schoolMember(30);
        const school = createId();
        await f.insert('organizations', {
          id: school,
          kind: 'school',
          owner_user_id: coach.userId,
          name: 'Fixture school',
          handle: createId(),
        });
        await f.sql`insert into memberships(organization_id,user_id,status,joined_at)
          values(${school},${student},'active',now())`;
        return coach.actorId;
      };
      const minorCoach = await enrollAtSchool(pupil.userId);
      const adultCoach = await enrollAtSchool(adultEntrant.userId);
      const seat = (roomId: string, actorId: string, side: string) =>
        f.sql`insert into room_participants(id,room_id,actor_id,seat_kind,side,slot)
          values(${createId()},${roomId},${actorId},'side',${side},0)`;
      await seat(frozenYouth, pupil.actorId, 'affirmative');
      await seat(live, pupil.actorId, 'affirmative');
      const [schoolBeforeEdit] = await f.sql`
        select youth_staff from public.daisy_room_community_fact(${live},${minorCoach})
      `;
      await f.sql`delete from room_participants where room_id=${live}`;
      await f.sql`update lobbies set age_rule='adults' where id=${matched}`;
      const mixed = await tournamentRoom(youth);
      await seat(mixed, pupil.actorId, 'affirmative');
      await seat(mixed, adultEntrant.actorId, 'negative');
      const [schoolPrivacy] = await f.sql`
        select
          (select youth_staff from public.daisy_room_community_fact(${frozenYouth},${minorCoach})) as "frozenYouthStaff",
          (select youth_staff from public.daisy_room_community_fact(${mixed},${minorCoach})) as "mixedMinorStaff",
          (select youth_staff from public.daisy_room_community_fact(${mixed},${adultCoach})) as "mixedAdultStaff"
      `;
      const [privacy] = await f.sql`
        select public.daisy_room_is_youth(${frozenOpen}) as "frozenOpen",
          public.daisy_room_is_youth(${frozenYouth}) as "frozenYouth",
          public.daisy_room_is_youth(${classifiedAtUpgrade}) as "classifiedAtUpgrade",
          (select legacy_tournament_youth from rooms where id=${classifiedAtUpgrade}) as "persistedAtUpgrade",
          public.daisy_room_is_youth(${live}) as "liveAfterEdit"
      `;
      const [remaining] = await f.sql`
        select (select count(*)::int from settings where key='entry.age_division') as settings,
          (select count(*)::int from lobbies where kind='standing'
           and owner_organization_id=${league} and handle like 'historical-%') as minted
      `;
      const writeWithParent = (parent: string) => () => f.sql`
        update lobbies set standing_lobby_id=${parent} where id=${open}
      `;
      assert({
        given:
          'an unambiguous rerun with matching and missing parents, a personal Youth tournament and frozen Rooms',
        should:
          'preserve ownership, age rules and Room privacy while refusing foreign or tournament parents',
        actual: {
          youth: [
            byId[youth]!.standing_lobby_id,
            byId[youth]!.age_rule,
            byId[youth]!.parent_rule,
          ],
          ageRule: byId[open]!.parent_rule,
          minted: /^[a-z0-9]{24}$/.test(minted) && minted !== foreign,
          local: byId[open]!.owner_organization_id,
          shared: byId[otherOpen]!.standing_lobby_id === minted,
          personal: [
            byId[personal]!.standing_lobby_id,
            byId[personal]!.age_rule,
          ],
          retry: afterRetry,
          liveBeforeEdit: beforeEdit?.youth,
          schoolBeforeEdit: schoolBeforeEdit?.youth_staff,
          schoolPrivacy,
          privacy,
          remaining,
          crossLeague: await rejectedBy(writeWithParent(foreign)),
          wrongKind: await rejectedBy(writeWithParent(youth)),
        },
        expected: {
          youth: [matched, null, 'under-18'],
          ageRule: 'adults',
          minted: true,
          local: league,
          shared: true,
          personal: [null, 'under-18'],
          retry: first,
          liveBeforeEdit: true,
          schoolBeforeEdit: true,
          schoolPrivacy: {
            frozenYouthStaff: true,
            mixedMinorStaff: true,
            mixedAdultStaff: false,
          },
          privacy: {
            frozenOpen: false,
            frozenYouth: true,
            classifiedAtUpgrade: true,
            persistedAtUpgrade: true,
            liveAfterEdit: false,
          },
          remaining: { settings: 0, minted: 1 },
          crossLeague: 'lobbies_standing_parent_league_fk',
          wrongKind: 'lobbies_standing_parent_kind_fk',
        },
      });

      const { id: round } = await f.roundWithCast(
        {
          room_id: mixed,
          format_id: format,
          room_config_snapshot: validConfig,
          visibility: 'public',
        },
        [
          { seat: 'affirmative', actorId: pupil.actorId },
          { seat: 'negative', actorId: adultEntrant.actorId },
        ],
      );
      const linked = await f.sql`
        select debater_actor_id from public.daisy_round_linked_adult_actors(${round})
      `;
      const [known] = await f.sql`
        select public.daisy_round_reuse_age_unknown(${round}) as blocked
      `;
      await f.sql`delete from account_age where user_id=${pupil.userId}`;
      const [erased] = await f.sql`
        select public.daisy_round_reuse_age_unknown(${round}) as blocked
      `;
      assert({
        given: 'a mixed tournament Round with a minor and an adult entrant',
        should:
          'expose only the minor’s linked-adult record and block reuse after age erasure',
        actual: { linked, known: known?.blocked, erased: erased?.blocked },
        expected: {
          linked: [{ debater_actor_id: pupil.actorId }],
          known: false,
          erased: true,
        },
      });
    } finally {
      await f.sql.close();
    }
  },
  ddlTimeoutMs,
);
