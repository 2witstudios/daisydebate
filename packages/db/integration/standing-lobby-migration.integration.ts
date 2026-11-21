import { SQL } from 'bun';
import { afterAll } from 'bun:test';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { publicLobbyId } from '../src/daisy-reference';
import { youthReuseFencedSql } from '../src/youth-round-sql';
import { readStudentLiveRounds } from '../src/youth-students-live';
import { createAuthorizationSubject } from './authorization.test-support';
import { Fixture, rejectedBy } from './constraint-helpers';
import { validConfig } from './round-fixtures';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

setupRitewayBun();
const scratch = scratchDatabase(
  requireTestServices(process.env).databaseUrl,
  'll1',
);
const migration = '20261121033014_standing_lobby_eligibility';

afterAll(() => scratch.drop());

test(
  'standing lobby migration preserves Room and challenge ownership',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < migration);
    // The whole scratch database is dropped after the test, including immutable consent evidence.
    const f = new Fixture(new SQL(scratch.url));
    try {
      const host = await f.actor();
      const challenger = await f.actor();
      const format = await f.format();
      const open = await f.room(host, format, { division: 'open' });
      const youth = await f.room(host, format, { division: 'youth' });
      const league = createId();
      await f.insert('organizations', {
        id: league,
        kind: 'league',
        name: 'School league',
        handle: league,
        owner_user_id: await f.user(),
        league_division: 'youth',
      });
      const otherLobby = createId();
      await f.insert('lobbies', {
        id: otherLobby,
        kind: 'standing',
        name: 'Under 18',
        handle: otherLobby,
        owner_organization_id: league,
      });
      const other = await f.room(host, format, {
        division: 'youth',
        lobby_id: otherLobby,
      });
      const eventLobby = createId();
      await f.insert('lobbies', {
        id: eventLobby,
        kind: 'tournament',
        name: 'Historical tournament',
        handle: eventLobby,
        owner_organization_id: league,
      });
      await f.insert(
        'tournaments',
        { lobby_id: eventLobby, status: 'draft' },
        'lobby_id',
      );
      const eventRooms: string[] = [];
      for (const division of ['youth', 'open'])
        eventRooms.push(
          await f.room(host, format, {
            division,
            lobby_id: eventLobby,
            lobby_kind: 'tournament',
            host_actor_id: null,
            capture: { broadcast: null, recordingPolicy: 'off' },
          }),
        );
      const student = await createAuthorizationSubject(f);
      const guardian = await createAuthorizationSubject(f);
      const stranger = await createAuthorizationSubject(f);
      await f.sql`update account_age set birth_month=to_char(now()-interval '16 years','YYYY-MM')
        where user_id=${student.userId}`;
      const consent = createId();
      await f.sql`insert into guardian_consent_evidence
        (id, person_user_id, role, method, notice_kind, notice_version, notice_digest, recorded_at)
        values (${consent}, ${guardian.userId}, 'guardian', 'created-account', 'parental-consent', 'fixture', repeat('0', 64), now())`;
      await f.sql`insert into guardian_links
        (id, guardian_user_id, minor_user_id, guardian_consent_id, status, activation, activated_at)
        values (${createId()}, ${guardian.userId}, ${student.userId}, ${consent}, 'active', 'created-account', now())`;
      const { id: eventRound } = await f.roundWithCast(
        {
          room_id: eventRooms[0]!,
          room_config_snapshot: validConfig,
          visibility: 'private',
          format_id: format,
        },
        [{ seat: 'affirmative', actorId: student.actorId }],
      );
      const accepted = createId();
      const pending = createId();
      const offer = {
        challenger_actor_id: challenger,
        challenged_actor_id: host,
        mode: 'casual',
        format_id: 'freestyle',
        created_at: new Date('2026-11-20T10:00:00Z'),
        expires_at: new Date('2026-11-20T10:05:00Z'),
      };
      await f.insert('challenges', {
        ...offer,
        id: accepted,
        division: 'youth',
        room_id: youth,
        follow_until: new Date('2026-11-20T10:06:00Z'),
      });
      await f.insert('challenges', { ...offer, id: pending, division: 'open' });

      await scratch.migrate((folder) => folder <= migration);

      const rooms = await f.sql<
        {
          id: string;
          lobby_id: string;
          age_rule: string;
          official: boolean;
          youth: boolean;
        }[]
      >`
      select r.id, r.lobby_id, l.age_rule, o.official,
             public.daisy_room_is_youth(r.id) as youth
      from rooms r join lobbies l on l.id=r.lobby_id
      join organizations o on o.id=l.owner_organization_id
      where r.id in ${f.sql([open, youth, other])}`;
      const offers = await f.sql<{ id: string; lobby_id: string }[]>`
      select id, lobby_id from challenges where id in ${f.sql([accepted, pending])}`;
      const byId = (id: string) => rooms.find((row) => row.id === id);
      const youthLobby = byId(youth)?.lobby_id;
      const wrongLobby = await rejectedBy(
        () =>
          f.sql`update challenges set lobby_id=${publicLobbyId} where id=${accepted}`,
      );
      const move = await rejectedBy(
        () =>
          f.sql`update rooms set lobby_id=${publicLobbyId} where id=${youth}`,
      );
      const columns = await f.sql`
      select column_name from information_schema.columns
       where table_schema='public' and table_name in ('rooms','challenges')
         and column_name='division'`;
      const [eventPolicy] = await f.sql`
        select public.daisy_room_is_youth(${eventRooms[0]!}) as prior_youth,
               public.daisy_room_is_youth(${eventRooms[1]!}) as prior_open`;
      const reclassifyEvent = await rejectedBy(
        () =>
          f.sql`update rooms set legacy_tournament_youth=false where id=${eventRooms[0]!}`,
      );
      // The constraints above belong to LL-1. Run today's readers only once
      // the scratch database also has their frozen Round fields.
      await scratch.migrate(() => true);
      const db = drizzle({ client: f.sql });
      const [reuse] = await db.execute(
        sql`select ${youthReuseFencedSql(sql`${eventRound}`)} as fenced`,
      );
      const students = async (userId: string, lobbyId = publicLobbyId) =>
        (await readStudentLiveRounds(db, userId, lobbyId)).map(
          ({ roundId }) => roundId,
        );
      assert({
        given:
          'Open, Youth, another league and both pending and accepted challenge records',
        should:
          'preserve each authority boundary and enforce the accepted Room’s exact lobby',
        actual: [
          byId(open),
          byId(youth),
          byId(other),
          offers.find((row) => row.id === accepted)?.lobby_id,
          offers.find((row) => row.id === pending)?.lobby_id,
          wrongLobby,
          move,
          columns.length,
          eventPolicy,
          reclassifyEvent,
          reuse?.fenced,
          await students(guardian.userId),
          await students(stranger.userId),
          await students(guardian.userId, ''),
        ],
        expected: [
          {
            id: open,
            lobby_id: publicLobbyId,
            age_rule: 'adults',
            official: true,
            youth: false,
          },
          {
            id: youth,
            lobby_id: youthLobby,
            age_rule: 'under-18',
            official: true,
            youth: true,
          },
          {
            id: other,
            lobby_id: otherLobby,
            age_rule: 'under-18',
            official: false,
            youth: true,
          },
          youthLobby,
          publicLobbyId,
          'challenges_room_lobby_fk',
          'rooms_lobby_immutable',
          0,
          { prior_youth: true, prior_open: false },
          'rooms_lobby_immutable',
          true,
          [eventRound],
          [],
          [eventRound],
        ],
      });
    } finally {
      await f.sql.close();
    }
  },
  ddlTimeoutMs,
);
