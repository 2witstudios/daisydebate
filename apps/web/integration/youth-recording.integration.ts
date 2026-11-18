import { daisyOrganizationId } from '@daisy/db/testing';
import { requireTestServices } from '@daisy/config';
import { plannedRecording } from '@daisy/debate-engine';
import { assertRejects } from '@daisy/errors/testing';
import { isJudgeSeat, isModeratorSeat } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  roundEvidencePermissions,
  type RecordingRound,
  type RecordingViewer,
} from '../src/features/recording/audience';
import { recordingPersistence } from '../src/features/recording/persistence';
import { requestParticipantRemoval } from '../src/features/recording/removal';
import { spectatorClockAt } from '../src/features/spectating/spectator-clock';
import { readyRankedRoom } from './ranked-room.test-support';
import { withRoomRuntime } from './room-runtime.test-support';
import { launchRuntimeRound } from './round-runtime.test-support';

setupRitewayBun();
requireTestServices(process.env);

/**
 * PYL-5: a Youth Round's Recording is private to its debaters, its judges and
 * each youth debater's linked coach or parent, against the real database and
 * its row-level security. Signed out, a stranger, a lapsed coach and the
 * public Watch listings learn nothing of it.
 */
type Fixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
type Member = Fixture['host'];
type Database = Parameters<typeof recordingPersistence>[0]['database'];

const setAge = (f: Fixture, member: Member, age: string) =>
  f.sql`update account_age
    set birth_month = to_char(now() - ${age}::interval, 'YYYY-MM'), version = version + 1,
      recorded_at = now() - interval '1 second'
    where user_id = ${member.userId}`;

/** Daisy's active seasons, one per division: a Youth Room needs its own to start ranked. */
const withYouthSeason = async (f: Fixture, run: () => Promise<void>) => {
  const ids: string[] = [];
  try {
    for (const division of ['open', 'youth'] as const) {
      const id = createId();
      await f.sql`insert into seasons(organization_id,id,division,name,starts_at,status)
        values(${daisyOrganizationId},${id},${division},'Youth recording fixture',now() - interval '1 day','active')`;
      ids.push(id);
    }
    await run();
  } finally {
    for (const id of ids) {
      await f.sql`delete from agreement_signatures where season_id=${id}`;
      await f.sql`delete from seasons where id=${id}`;
    }
  }
};

/** A school the youth debater belongs to, with a coach holding a roster grant. */
const schoolWithCoach = async (
  f: Fixture,
  made: { readonly schools: string[] },
  input: {
    readonly owner: Member;
    readonly coach: Member;
    readonly student: Member;
  },
) => {
  const id = createId();
  made.schools.push(id);
  const [role] = await f.sql`select r.id from roles r
    join role_permissions p on p.role_id = r.id
    where r.preset and p.permission = 'school.roster.manage' limit 1`;
  await f.sql`insert into organizations(id,kind,name,handle,owner_user_id)
    values(${id},'school','Riverside High',${`riverside-${id.slice(0, 8)}`},${input.owner.userId})`;
  for (const member of [input.coach, input.student])
    await f.sql`insert into memberships(organization_id,user_id,status,joined_at)
      values(${id},${member.userId},'active',now())`;
  const grantId = createId();
  await f.sql`insert into grants(id,role_id,user_id,scope_kind,organization_id,granted_at)
    values(${grantId},${role!.id},${input.coach.userId},'organization',${id},now())`;
  return { id, grantId };
};

/** Removes the links and schools a test made, so the fixture can drop its people. */
const withLinks = async (
  f: Fixture,
  run: (made: {
    readonly schools: string[];
    readonly users: string[];
    readonly rounds: string[];
  }) => Promise<void>,
) => {
  const made = {
    schools: [] as string[],
    users: [] as string[],
    rounds: [] as string[],
  };
  try {
    await run(made);
  } finally {
    // Grants and links are append-only by trigger; a test's own rows go in one
    // transaction that bypasses only user triggers, children first.
    await f.sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      for (const roundId of made.rounds)
        await tx`delete from recordings where round_id=${roundId}`;
      for (const userId of made.users)
        await tx`delete from guardian_links where guardian_user_id=${userId} or minor_user_id=${userId}`;
      for (const id of made.schools) {
        await tx`delete from grants where organization_id=${id}`;
        await tx`delete from membership_periods where organization_id=${id}`;
        await tx`delete from memberships where organization_id=${id}`;
        await tx`delete from organizations where id=${id}`;
      }
    });
  }
};

/** The Round as the Recording reads it, the same projection the web composes. */
const recordingRoundOf = async (
  database: Database,
  roundId: string,
): Promise<RecordingRound> => {
  const round = (await database.readRecordingRound(roundId))!;
  return {
    id: round.id,
    competitionType: round.competitionType,
    visibility: round.visibility,
    audienceLinkHash: round.audienceLinkHash,
    hostActorId: round.hostActorId,
    completedAtMs: round.completedAtMs,
    seatedActorIds: round.seats.map((seat) => seat.actorId),
    recordingPolicy: plannedRecording(round),
    officialActorIds: round.seats
      .filter((seat) => isJudgeSeat(seat.seat) || isModeratorSeat(seat.seat))
      .map((seat) => seat.actorId),
    youth: await database.readYouthRecordingPeople(roundId),
  };
};

const viewerOf = (member: Member): RecordingViewer => ({
  kind: 'account',
  userId: member.userId,
  actorId: member.actorId,
});

/** Two Youth debaters (host and guest) and an adult judge, launched. */
const endedYouthRound = async (f: Fixture) => {
  await setAge(f, f.host, '16 years');
  await setAge(f, f.guest, '17 years');
  await setAge(f, f.outsider, '30 years');
  const room = await readyRankedRoom(f, 'freestyle', 'human');
  const { roundId } = await launchRuntimeRound(f, room);
  return { roundId };
};

const people = async (f: Fixture) => {
  const coach = await f.member();
  const parent = await f.member();
  const owner = await f.member();
  const stranger = await f.member();
  for (const adult of [coach, parent, owner, stranger])
    await setAge(f, adult, '40 years');
  return { coach, parent, owner, stranger };
};

test('a Youth Round’s Recording is private to its debaters, judges and linked adults', async () => {
  await withRoomRuntime(async (f) =>
    withYouthSeason(f, () =>
      withLinks(f, async (made) => {
        const database = f.store as never as Database & {
          readonly broadcasts: {
            readonly discoverUnopened: (
              limit: number,
            ) => Promise<readonly { readonly roundId: string }[]>;
          };
        };
        const { coach, parent, owner, stranger } = await people(f);
        const { roundId } = await endedYouthRound(f);
        const unopened = await database.broadcasts.discoverUnopened(1000);
        const school = await schoolWithCoach(f, made, {
          owner,
          coach,
          student: f.host,
        });
        made.users.push(parent.userId);
        await f.sql`insert into guardian_links(id,guardian_user_id,minor_user_id,kind,status)
        values(${createId()},${parent.userId},${f.guest.userId},'parent','active')`;
        await f.sql`update rounds set status='completed', current_stage=null, started_at=coalesce(started_at, now()), winning_side='affirmative', completed_at=now() where id=${roundId}`;
        const [division] =
          await f.sql`select ladder_division from rounds where id=${roundId}`;
        const round = await recordingRoundOf(database, roundId);
        const release = await database.readRecordingBroadcastRelease(
          roundId,
          spectatorClockAt(new Date().toISOString()),
        );
        const sees = (viewer: RecordingViewer) =>
          roundEvidencePermissions(round, release, viewer, null, Date.now())
            .media;
        assert({
          given:
            'a ranked Youth Round with a school coach and a parent linked to its debaters',
          should:
            'show it to the debater, judge, coach and parent, and to nobody else, and never open a Broadcast',
          actual: {
            division: division!.ladder_division,
            broadcastDiscovered: unopened.some(
              (row) => row.roundId === roundId,
            ),
            debater: sees(viewerOf(f.host)),
            judge: sees(viewerOf(f.outsider)),
            coach: sees(viewerOf(coach)),
            parent: sees(viewerOf(parent)),
            schoolOwner: sees(viewerOf(owner)),
            stranger: sees(viewerOf(stranger)),
            signedOut: sees({ kind: 'visitor' }),
          },
          expected: {
            division: 'youth',
            broadcastDiscovered: false,
            debater: true,
            judge: true,
            coach: true,
            parent: true,
            schoolOwner: true,
            stranger: false,
            signedOut: false,
          },
        });

        await f.sql`update grants set revoked_at=now(), revoked_by_user_id=${owner.userId} where id=${school.grantId}`;
        await f.sql`update guardian_links set status='ended', ended_at=now() where guardian_user_id=${parent.userId}`;
        const lapsed = await recordingRoundOf(database, roundId);
        assert({
          given: 'the coach’s grant revoked and the parent’s link ended',
          should: 'admit neither any more',
          actual: [coach, parent].map(
            (adult) =>
              roundEvidencePermissions(
                lapsed,
                release,
                viewerOf(adult),
                null,
                Date.now(),
              ).media,
          ),
          expected: [false, false],
        });

        made.rounds.push(roundId);
        await f.sql`insert into recordings (id,round_id,recording_class,eligibility,status,lifecycle)
          values (${createId()},${roundId},'ranked',${{ kind: 'ranked', youth: true }},'ready',${{ status: 'ready' }})`;
        // Ready video, past the ranked delay: everything the public archive asks
        // for but the division.
        const clock = spectatorClockAt(
          new Date(Date.now() + 600_000).toISOString(),
        );
        const archive = (scope: 'all' | 'mine', viewerActorId: string | null) =>
          database
            .listRecordingArchive({
              query: { scope, mode: 'any', q: '', sort: 'newest', before: '' },
              viewerActorId,
              clock,
              limit: 100,
            })
            .then((page) => page.rows.some((row) => row.id === roundId));
        assert({
          given: 'the public archive and the debater’s own list',
          should: 'leave it out of the public archive and keep it in their own',
          actual: {
            publicArchive: await archive('all', stranger.actorId),
            ownList: await archive('mine', f.host.actorId),
          },
          expected: { publicArchive: false, ownList: true },
        });

        // A follower of a youth debater is never told of the Recording; its seats are.
        const [host] =
          await f.sql`select username from users where id=${f.host.userId}`;
        await f.store.setDebaterFollow({
          followerUserId: stranger.userId,
          username: host!.username,
          state: 'following',
        });
        await f.store.sweepNotificationFanouts({
          clock: spectatorClockAt(new Date(Date.now() + 600_000).toISOString()),
          limit: 50,
          nextId: createId,
        });
        const told = async (member: Member) =>
          (
            await f.store.readNotifications({
              after: null,
              userId: member.userId,
              unreadOnly: false,
              limit: 10,
              now: new Date().toISOString(),
            })
          ).rows.some((row) => row.kind === 'recording_ready');
        assert({
          given:
            'a stranger following a youth debater whose Recording is ready',
          should: 'tell the debater and not the follower',
          actual: {
            debater: await told(f.host),
            follower: await told(stranger),
          },
          expected: { debater: true, follower: false },
        });
        await f.sql`delete from notifications where round_id=${roundId}`;
        await f.sql`delete from notification_fanouts where round_id=${roundId}`;
        await f.sql`delete from debater_follows where follower_user_id=${stranger.userId}`;
      }),
    ),
  );
});

test('any youth debater of a Youth Round, or their linked adult, takes its Recording down', async () => {
  await withRoomRuntime(async (f) =>
    withYouthSeason(f, () =>
      withLinks(f, async (made) => {
        const database = f.store as never as Database;
        const { parent } = await people(f);
        made.users.push(parent.userId);
        const { roundId } = await endedYouthRound(f);
        await f.sql`insert into guardian_links(id,guardian_user_id,minor_user_id,kind,status)
        values(${createId()},${parent.userId},${f.guest.userId},'parent','active')`;
        await f.sql`update rounds set status='completed', current_stage=null, started_at=coalesce(started_at, now()), winning_side='affirmative', completed_at=now() where id=${roundId}`;
        const store = recordingPersistence({ database });
        made.rounds.push(roundId);
        const recording = await store.request({
          id: createId(),
          roundId,
          class: 'ranked',
          eligibility: { kind: 'ranked', youth: true },
        });
        const inputs = {
          readRound: (id: string) => recordingRoundOf(database, id),
        };
        const remove = (member: Member) =>
          requestParticipantRemoval(
            { store, inputs },
            {
              recordingId: recording.id,
              expectedVersion: recording.version,
              viewer: viewerOf(member),
              now: new Date().toISOString(),
            },
          );
        await assertRejects({
          given: 'the adult judge of a Youth Round',
          should: 'refuse the takedown',
          actual: () => remove(f.outsider),
          code: 'AUTHORIZATION',
        });
        assert({
          given: 'a youth debater’s parent',
          should: 'take the whole ranked Recording down',
          actual: (await remove(parent)).lifecycle.status,
          expected: 'removing',
        });
      }),
    ),
  );
});
