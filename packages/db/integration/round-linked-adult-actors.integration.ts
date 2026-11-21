import type { SQL } from 'bun';
import { linkedAdultsOfRound } from '@daisy/auth/linked-adults';
import {
  linkedAdultExpectationOf,
  linkedAdultFactsOf,
  linkedAdultFixtures,
  type FixtureIds,
  type LinkedAdultFixture,
} from '@daisy/auth/linked-adults-testing';
import { requireTestServices } from '@daisy/config';
import type { AgeBand } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  readLinkedAdultUserIds,
  readYouthRecordingPeople,
} from '../src/youth-recording-people';
import { Fixture } from './constraint-helpers';
import { validConfig } from './round-fixtures';
import { integrationSuite } from './suite.test-support';
import { inRolledBackTransaction } from './tab.test-support';

setupRitewayBun();
requireTestServices(process.env);
const { databaseUrl: url } = integrationSuite();

/** An age record this band's whole month long, by the database's clock. */
const ageOf: Record<AgeBand, string> = {
  'under-13': '12 years',
  '13-15': '14 years',
  '16-17': '16 years 6 months',
  adult: '40 years',
};

const roleWith = async (sql: SQL, roster: boolean) => {
  const [role] = await sql`select r.id from roles r where r.preset
    and ${roster} = exists (select 1 from role_permissions p
      where p.role_id = r.id and p.permission = 'school.roster.manage')
    order by r.id limit 1`;
  return role!.id as string;
};

type Ids = Record<string, { userId: string; actorId: string }>;

/** Each named person: a user, their age record if any, and one actor. */
const seedPeople = async (f: Fixture, fixture: LinkedAdultFixture) => {
  const people: Ids = {};
  for (const [name, band] of Object.entries(fixture.people)) {
    const userId = createId();
    await f.sql`insert into users(id, username) values(${userId}, ${`u-${userId}`})`;
    if (band !== null)
      await f.sql`insert into account_age(user_id, birth_month, version, recorded_at)
        values(${userId}, to_char(now() - ${ageOf[band]}::interval, 'YYYY-MM'), 1, now() - interval '1 second')`;
    people[name] = { userId, actorId: await f.actor(userId) };
  }
  return people;
};

/** The organizations, memberships, grants and guardian links between them. */
const seedLinks = async (
  sql: SQL,
  fixture: LinkedAdultFixture,
  people: Ids,
) => {
  const user = (name: string) => people[name]!.userId;
  const ended = (active: boolean) => (active ? null : new Date());
  const organizations: Record<string, string> = {};
  for (const o of fixture.organizations ?? []) {
    const id = createId();
    organizations[o.name] = id;
    await sql`insert into organizations(id, kind, name, handle, owner_user_id, closed_at)
      values(${id}, ${o.school ? 'school' : 'family'}, ${o.name}, ${`${o.name}-${id.slice(0, 8)}`},
        ${o.owner === null ? null : user(o.owner)}, ${ended(o.open)})`;
  }
  for (const m of fixture.memberships ?? [])
    await sql`insert into memberships(organization_id, user_id, status, joined_at, ended_at)
      values(${organizations[m.organization]!}, ${user(m.person)},
        ${m.active ? 'active' : 'ended'}, now() - interval '1 day', ${ended(m.active)})`;
  for (const g of fixture.grants ?? [])
    await sql`insert into grants(id, role_id, user_id, scope_kind, organization_id, granted_at, expires_at, revoked_at, revoked_by_user_id)
      values(${createId()}, ${await roleWith(sql, g.rosterManage)}, ${user(g.person)},
        'organization', ${organizations[g.organization]!}, now() - interval '2 days',
        ${g.state === 'expired' ? new Date(Date.now() - 86_400_000) : null},
        ${g.state === 'revoked' ? new Date() : null}, ${g.state === 'revoked' ? user(g.person) : null})`;
  for (const link of fixture.guardianLinks ?? []) {
    const consent = createId();
    await sql`insert into guardian_consent_evidence
      (id, person_user_id, role, method, notice_kind, notice_version, notice_digest, recorded_at)
      values (${consent}, ${user(link.guardian)}, 'guardian', 'created-account', 'parental-consent', 'fixture', repeat('0', 64), now())`;
    await sql`insert into guardian_links
      (id, guardian_user_id, minor_user_id, guardian_consent_id, status, activation, activated_at, closed_at)
      values (${createId()}, ${user(link.guardian)}, ${user(link.minor)}, ${consent},
        ${link.active ? 'active' : 'ended'}, 'created-account', now(), case when ${link.active} then null else now() end)`;
  }
  return organizations;
};

/** The Round, its Room if it has one, and its seats; its id. */
const seedRound = async (
  f: Fixture,
  fixture: LinkedAdultFixture,
  people: Ids,
) => {
  const ranked = fixture.round.ladder !== null;
  const [preset] =
    await f.sql`select format_version, version from format_presets where format_id = 'freestyle' and superseded_at is null`;
  // A ranked Round rates on a ladder, which needs the Freestyle preset.
  const format = ranked
    ? {
        format_id: 'freestyle',
        format_version: preset!.format_version,
        preset_version: preset!.version,
      }
    : { format_id: await f.format() };
  const competition = { competition_type: ranked ? 'ranked' : 'casual' };
  let roomId: string | null = null;
  if (fixture.round.room !== null) {
    const ageRule = fixture.round.room === 'youth' ? 'under-18' : 'adults';
    const [lobby] = await f.sql`select l.id from lobbies l
      join organizations o on o.id=l.owner_organization_id
      where l.kind='standing' and o.official and l.age_rule=${ageRule}`;
    roomId = await f.room(await f.actor(), format.format_id, {
      lobby_id: lobby!.id,
      ...competition,
      ...format,
    });
  }
  const roundId = await f.round({
    room_id: roomId,
    // A Room's Round freezes what the Room set (rounds_room_freeze_complete).
    ...(roomId === null
      ? {}
      : { room_config_snapshot: validConfig, visibility: 'public' }),
    ...format,
    ...competition,
    ladder_id: ranked ? 'freestyle' : null,
    ladder_division: fixture.round.ladder,
  });
  const debaters = fixture.seats.filter((seat) => seat.kind === 'debater');
  for (const [index, seat] of debaters.entries())
    await f.seat(
      roundId,
      index % 2 === 0 ? 'affirmative' : 'negative',
      Math.floor(index / 2),
      people[seat.person]!.actorId,
    );
  for (const seat of fixture.seats.filter((each) => each.kind === 'moderator'))
    await f.seat(roundId, 'moderator', 0, people[seat.person]!.actorId);
  return roundId;
};

/** Seeds one fixture's people, schools and Round; returns their ids. */
const seed = async (sql: SQL, fixture: LinkedAdultFixture) => {
  const f = new Fixture(sql);
  const people = await seedPeople(f, fixture);
  const organizations = await seedLinks(sql, fixture, people);
  const roundId = await seedRound(f, fixture, people);
  return { roundId, people: people as FixtureIds, organizations };
};

/** The function's answer as a runtime role, sorted as the rule sorts. */
const asRole = async (sql: SQL, role: string, roundId: string) => {
  await sql.unsafe(`set local role ${role}`);
  const read = await readYouthRecordingPeople(
    drizzle({ client: sql }),
    roundId,
  );
  await sql.unsafe('reset role');
  return {
    debaters: read.debaters.map((debater) => ({
      ...debater,
      linkedAdultActorIds: [...debater.linkedAdultActorIds].sort(),
    })),
  };
};

/**
 * ADR 0158: the linked-adult rule's SQL statement,
 * `daisy_round_linked_adult_actors`, answers exactly as its TypeScript
 * statement, `linkedAdultsOfRound`, and as each shared fixture expects, for
 * the web's runtime role and the realtime role alike: every kind of linked
 * adult allowed, every other adult and stranger refused, and only the youth
 * debaters in a mixed-age Open Round.
 */
for (const fixture of linkedAdultFixtures)
  test(`daisy_round_linked_adult_actors: ${fixture.given}`, async () => {
    await inRolledBackTransaction(url, async (sql) => {
      const { roundId, people, organizations } = await seed(sql, fixture);
      const web = await asRole(sql, 'daisy_web', roundId);
      const realtime = await asRole(sql, 'daisy_realtime', roundId);
      assert({
        given: fixture.given,
        should: `${fixture.should}, for the web and the realtime role, as the TypeScript rule does`,
        actual: { web, realtime },
        expected: {
          web: linkedAdultsOfRound(
            linkedAdultFactsOf(fixture, people, organizations),
          ),
          realtime: linkedAdultExpectationOf(fixture, people),
        },
      });
      assert({
        given: fixture.given,
        should: 'agree with the fixture’s expectation',
        actual: web,
        expected: linkedAdultExpectationOf(fixture, people),
      });
    });
  });

test('a minor’s linked adults read through the one rule, leaving the caller’s scope alone', async () => {
  await inRolledBackTransaction(url, async (sql) => {
    const fixture = linkedAdultFixtures[0]!;
    const { people } = await seed(sql, fixture);
    await sql.unsafe('set local role daisy_web');
    await sql`select set_config('daisy.lobby_scope', 'caller-lobby', true)`;
    const linked = await readLinkedAdultUserIds(
      drizzle({ client: sql }),
      people.student!.userId,
    );
    const [scope] =
      await sql`select current_setting('daisy.lobby_scope', true) as lobby`;
    await sql.unsafe('reset role');
    assert({
      given: 'the student of the every-kind fixture, read as the web role',
      should:
        'name the parent, the owner and the coach, and keep the caller’s scope',
      actual: { linked: [...linked].sort(), lobby: scope!.lobby },
      expected: {
        linked: ['coach', 'owner', 'parent']
          .map((name) => people[name]!.userId)
          .sort(),
        lobby: 'caller-lobby',
      },
    });
  });
});

test('only the web and the realtime role may run the Round read, and only the web the minor read', async () => {
  await inRolledBackTransaction(url, async (sql) => {
    const roles = ['daisy_web', 'daisy_realtime', 'public'];
    const can = async (fn: string) =>
      Promise.all(
        roles.map(async (role) => {
          const [row] = await sql.unsafe(
            role === 'public'
              ? `select bool_or(a.privilege_type = 'EXECUTE' and a.grantee = 0) as allowed
                  from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.proname = $1`
              : `select has_function_privilege($2, p.oid, 'EXECUTE') as allowed
                  from pg_proc p where p.proname = $1`,
            role === 'public' ? [fn] : [fn, role],
          );
          return [role, Boolean(row!.allowed)] as const;
        }),
      ).then(Object.fromEntries);
    assert({
      given: 'the two registered functions (ADR 0129 §4)',
      should:
        'grant the Round read to the web and realtime roles, the minor read to the web only, and neither to PUBLIC',
      actual: {
        round: await can('daisy_round_linked_adult_actors'),
        minor: await can('daisy_linked_adult_users'),
      },
      expected: {
        round: { daisy_web: true, daisy_realtime: true, public: false },
        minor: { daisy_web: true, daisy_realtime: false, public: false },
      },
    });
  });
});
