import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roomFacts } from '../src/room-command-facts';
import { rooms } from '../src/schema/rooms';
import { rejectedBy, withFixture, type Fixture } from './constraint-helpers';
import { validConfig } from './round-fixtures';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('a tournament lobby inherits its standing parent’s age rule, a frozen Room keeps its own, and the parent must be its league’s standing lobby', async () => {
  const schools: string[] = [];
  await withFixture(url, async (f) => {
    try {
      await eligibility(f, schools);
    } finally {
      // Memberships RESTRICT their school; the fixture does not track them.
      for (const school of schools) {
        await f.sql`delete from membership_periods where organization_id=${school}`;
        await f.sql`delete from memberships where organization_id=${school}`;
      }
    }
  });
});

const eligibility = async (f: Fixture, schools: string[]) => {
  const owner = await f.user();
  const host = await f.actor();
  const format = await f.format();
  const league = async (name: string) => {
    const id = createId();
    await f.insert('organizations', {
      id,
      kind: 'league',
      owner_user_id: owner,
      name,
      handle: createId(),
    });
    return id;
  };
  const home = await league('Home league');
  const other = await league('Other league');
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
  const youthParent = await standing(home, 'under-18');
  const foreign = await standing(other, 'adults');
  const tournament = async (parent: string) => {
    const id = createId();
    await f.insert('lobbies', {
      id,
      kind: 'tournament',
      name: 'Tournament',
      handle: createId(),
      owner_organization_id: home,
      standing_lobby_id: parent,
      age_rule: null,
    });
    await f.insert('tournaments', { lobby_id: id }, 'lobby_id');
    return id;
  };
  const youth = await tournament(youthParent);
  const otherTournament = await tournament(youthParent);
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
  // A Room frozen Open inside a Youth tournament, one frozen Youth.
  const frozenOpen = await tournamentRoom(youth, false);
  const frozenYouth = await tournamentRoom(youth, true);
  const live = await tournamentRoom(youth);
  const database = drizzle({ client: f.sql });
  const projectedRule = async (roomId: string) => {
    const [row] = await database
      .select()
      .from(rooms)
      .where(eq(rooms.id, roomId));
    return (await roomFacts(database, row!)).state.ageRule;
  };
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
    schools.push(school);
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
  await f.sql`update lobbies set age_rule='adults' where id=${youthParent}`;
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
        public.daisy_room_is_youth(${live}) as "liveAfterEdit"
    `;
  const writeWithParent = (parent: string) => () => f.sql`
      update lobbies set standing_lobby_id=${parent} where id=${youth}
    `;
  assert({
    given:
      'a tournament under a Youth standing lobby holding Rooms frozen Open, frozen Youth and unfrozen, then the parent turned adults-only',
    should:
      'keep each frozen Room’s privacy, let the unfrozen Room follow its parent, and refuse a foreign or tournament parent',
    actual: {
      liveBeforeEdit: beforeEdit?.youth,
      schoolBeforeEdit: schoolBeforeEdit?.youth_staff,
      schoolPrivacy,
      roomRules: [
        await projectedRule(frozenOpen),
        await projectedRule(frozenYouth),
        await projectedRule(mixed),
        await projectedRule(live),
      ],
      privacy,
      crossLeague: await rejectedBy(writeWithParent(foreign)),
      wrongKind: await rejectedBy(writeWithParent(otherTournament)),
    },
    expected: {
      liveBeforeEdit: true,
      schoolBeforeEdit: true,
      schoolPrivacy: {
        frozenYouthStaff: true,
        mixedMinorStaff: true,
        mixedAdultStaff: false,
      },
      roomRules: ['adults', 'under-18', 'under-18', 'adults'],
      privacy: {
        frozenOpen: false,
        frozenYouth: true,
        liveAfterEdit: false,
      },
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
};
