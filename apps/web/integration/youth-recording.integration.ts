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
import {
  schoolWithCoach,
  setAge,
  withLinks,
  withYouthSeason,
  type Fixture,
  type Member,
} from './youth-round.test-support';

setupRitewayBun();
requireTestServices(process.env);

/**
 * PYL-5: a Youth Round's Recording is private to its debaters, its judges and
 * each youth debater's linked coach or parent, against the real database and
 * its row-level security. Signed out, a stranger, a lapsed coach and the
 * public Watch listings learn nothing of it.
 */
type Database = Parameters<typeof recordingPersistence>[0]['database'];

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
    youth: {
      ...(await database.readYouthRoundPeople(roundId)),
      public: false,
    },
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
              youthPublishing: false,
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
