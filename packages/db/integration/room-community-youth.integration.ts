import { drizzle } from 'drizzle-orm/bun-sql';
import { createId } from '@paralleldrive/cuid2';
import { decideRoomCommunity } from '@daisy/auth/room-community';
import { namesHumanJudge } from '@daisy/debate-engine';
import { createAppError } from '@daisy/errors';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withFixture, type Fixture } from './constraint-helpers';
import {
  cleanupRoomChat,
  databaseUrl,
  member,
  now,
  refusal,
  send,
  seat,
} from './room-community.test-support';
import { createRoomCommunityStore } from '../src/messaging/room-community-store';
import type { RoomCommunityFence } from '../src/messaging/room-community-contracts';

setupRitewayBun();

/**
 * Decision 84: in a Youth Room only the people in it chat. A seatless member,
 * adult or minor, reads and is refused at the command; the seated debaters,
 * the judge (who reads, DEC-174), the host and a seated youth debater's club
 * staff keep their standing. An Open Room is unchanged. Real database, real
 * `daisy_room_community_fact`, the store's own fence.
 */
type Member = Awaited<ReturnType<typeof member>>;
const authorize: RoomCommunityFence = async ({
  scope,
  fact,
  account,
  action,
}) => {
  if (
    !decideRoomCommunity({ principal: scope, fact, account, action, now }).allow
  )
    throw createAppError('AUTHORIZATION');
};

/** Under 18 all this month, by the database's own clock. */
const makeMinor = (f: Fixture, person: Member) =>
  f.sql`update account_age
    set birth_month = to_char(now() - interval '17 years', 'YYYY-MM'), version = version + 1
    where user_id = ${person.userId}`;

/** A school the student belongs to, owned by another adult, where the coach holds a roster grant. */
const school = async (
  f: Fixture,
  made: string[],
  people: { readonly coach: Member; readonly student: Member },
) => {
  const id = createId();
  made.push(id);
  const [role] = await f.sql`select r.id from roles r
    join role_permissions p on p.role_id = r.id
    where r.preset and p.permission = 'school.roster.manage' limit 1`;
  const owner = await member(f);
  await f.sql`insert into organizations(id,kind,name,handle,owner_user_id)
    values(${id},'school','Riverside High',${`riverside-${id.slice(0, 8)}`},${owner.userId})`;
  for (const person of [people.coach, people.student])
    await f.sql`insert into memberships(organization_id,user_id,status,joined_at)
      values(${id},${person.userId},'active',now())`;
  await f.sql`insert into grants(id,role_id,user_id,scope_kind,organization_id,granted_at)
    values(${createId()},${role!.id},${people.coach.userId},'organization',${id},now())`;
  return owner;
};

const dropSchools = (f: Fixture, ids: readonly string[]) =>
  f.sql.begin(async (tx) => {
    // Grants are append-only by trigger; only this test's rows go.
    await tx`set local session_replication_role = replica`;
    for (const id of ids) {
      await tx`delete from grants where organization_id=${id}`;
      await tx`delete from membership_periods where organization_id=${id}`;
      await tx`delete from memberships where organization_id=${id}`;
      await tx`delete from organizations where id=${id}`;
    }
  });

/**
 * A public ranked Freestyle Room in a lobby (ADR 0162), hosted by a seatless
 * adult, its chat opened.
 */
const rankedRoom = async (
  f: Fixture,
  host: Member,
  division: 'open' | 'youth',
) => {
  const [preset] = await f.sql`select format_version,version from format_presets
    where format_id='freestyle' and superseded_at is null`;
  const roomId = await f.room(host.actorId, 'freestyle', {
    competition_type: 'ranked',
    lobby_id: (
      await f.sql`select l.id from lobbies l join organizations o on o.id=l.owner_organization_id where o.official and l.age_rule=${division === 'youth' ? 'under-18' : 'adults'}`
    )[0]!.id,
    format_version: preset!.format_version,
    preset_version: preset!.version,
  });
  const store = createRoomCommunityStore(
    drizzle({ client: f.sql }),
    authorize,
    namesHumanJudge,
  );
  const opened = await store.open({
    roomId,
    ...host,
    newChannelId: createId(),
  });
  return { roomId, store, channelId: opened.channelId };
};

/** What each person may do in the Room's chat: post, read, and what discovery says. */
const standingOf = async (
  room: Awaited<ReturnType<typeof rankedRoom>>,
  person: Member,
) => {
  const scope = {
    roomId: room.roomId,
    channelId: room.channelId,
    ...person,
  };
  return {
    post: (await refusal(() => send(room.store, scope))) ?? 'sent',
    read:
      (await refusal(() =>
        room.store.readChat(scope, (frame) => frame.history({ limit: 10 })),
      )) ?? 'read',
    readOnly: (await room.store.discover(scope))?.readOnly ?? null,
  };
};

test('in a Youth Room only the people in it chat; an Open Room is unchanged (decision 84)', async () =>
  withFixture(databaseUrl, async (f) => {
    const schools: string[] = [];
    try {
      const people = {
        host: await member(f),
        debater: await member(f),
        opponent: await member(f),
        judge: await member(f),
        adultSpectator: await member(f),
        minorSpectator: await member(f),
        coach: await member(f),
        otherCoach: await member(f),
        stranger: await member(f),
      };
      for (const minor of [
        people.debater,
        people.opponent,
        people.minorSpectator,
        people.stranger,
      ])
        await makeMinor(f, minor);
      const schoolOwner = await school(f, schools, {
        coach: people.coach,
        student: people.debater,
      });
      // A coach of a school with no student in this Room stays a spectator.
      await school(f, schools, {
        coach: people.otherCoach,
        student: people.stranger,
      });
      const youth = await rankedRoom(f, people.host, 'youth');
      await seat(f, youth.roomId, people.debater.actorId, 'affirmative');
      await seat(f, youth.roomId, people.opponent.actorId, 'negative');
      await seat(f, youth.roomId, people.judge.actorId, 'judge');
      const open = await rankedRoom(f, people.host, 'open');
      await seat(f, open.roomId, people.judge.actorId, 'affirmative');
      await seat(f, open.roomId, people.coach.actorId, 'negative');

      const roles = [
        'adultSpectator',
        'minorSpectator',
        'otherCoach',
        'debater',
        'judge',
        'host',
        'coach',
      ] as const;
      const youthTable = Object.fromEntries([
        ...(await Promise.all(
          roles.map(async (role) => [
            role,
            await standingOf(youth, people[role]),
          ]),
        )),
        ['schoolOwner', await standingOf(youth, schoolOwner)],
      ]);
      const openTable = Object.fromEntries(
        await Promise.all(
          (['adultSpectator', 'minorSpectator'] as const).map(async (role) => [
            role,
            await standingOf(open, people[role]),
          ]),
        ),
      );
      const spectator = {
        post: 'AUTHORIZATION',
        read: 'read',
        readOnly: true,
      };
      const poster = { post: 'sent', read: 'read', readOnly: false };
      assert({
        given:
          'a ranked Room two minors debate in, judged by an adult and hosted by a seatless adult, read by an adult and a minor without a seat, by a debater’s coach and their school’s owner, and by an unrelated school’s coach, and an Open ranked Room',
        should:
          'refuse posting to every seatless reader but the debater’s club staff, keep the debaters, the host and the staff posting and the judge reading, and let anyone post in the Open Room',
        actual: { youth: youthTable, open: openTable },
        expected: {
          youth: {
            adultSpectator: spectator,
            minorSpectator: spectator,
            otherCoach: spectator,
            debater: poster,
            judge: spectator,
            host: poster,
            coach: poster,
            schoolOwner: poster,
          },
          open: { adultSpectator: poster, minorSpectator: poster },
        },
      });
    } finally {
      for (const roomId of f.tracked.get('rooms') ?? [])
        await cleanupRoomChat(f, roomId);
      await dropSchools(f, schools);
    }
  }));
