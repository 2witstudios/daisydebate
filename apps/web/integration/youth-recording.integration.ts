import { daisyOrganizationId } from '@daisy/db/testing';
import { requireTestServices } from '@daisy/config';
import { plannedRecording } from '@daisy/debate-engine';
import { assertRejects } from '@daisy/errors/testing';
import {
  isJudgeSeat,
  isModeratorSeat,
  judgeSeat,
  type RoomCapture,
} from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  roundEvidencePermissions,
  type RecordingRound,
  type RecordingViewer,
} from '../src/features/recording/audience';
import { openDownload } from '../src/features/recording/download';
import { recordingPersistence } from '../src/features/recording/persistence';
import { requestParticipantRemoval } from '../src/features/recording/removal';
import { spectatorClockAt } from '../src/features/spectating/spectator-clock';
import { readyRankedRoom } from './ranked-room.test-support';
import {
  assembleJudgedRoom,
  everyoneReady,
} from './round-judging.test-support';
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
    // As the web composes it: the Round's own youth fact decides (ADR 0157).
    youth: round.youthRound
      ? { ...(await database.readYouthRecordingPeople(roundId)), public: false }
      : null,
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

/** A casual Room's capture choice: an audience Broadcast and a released Recording. */
const broadcastAndRecord: RoomCapture = {
  broadcast: {
    release: { kind: 'delay', seconds: 60 },
    debatersReadChat: false,
  },
  recordingPolicy: 'released',
};

const complete = (f: Fixture, roundId: string) =>
  f.sql`update rounds set status='completed', current_stage=null, started_at=coalesce(started_at, now()) - interval '1 hour', winning_side='affirmative', completed_at=now() where id=${roundId}`;

type BroadcastDiscovery = {
  readonly broadcasts: {
    readonly discoverUnopened: (
      limit: number,
    ) => Promise<readonly { readonly roundId: string }[]>;
    readonly endYouthBroadcasts: (now: Date) => Promise<readonly string[]>;
  };
};

/**
 * A casual Round with one human judge, its host opted into a Broadcast and a
 * Recording, launched and ended. Its Room takes its host's lobby (ADR 0156).
 */
const endedCasualRound = async (
  f: Fixture,
  cast: { readonly host: Member; readonly guest: Member },
  judge: Member,
) => {
  let room = await assembleJudgedRoom(f, 1, cast);
  room = (
    await f.command(judge, room, { type: 'claim-seat', seat: judgeSeat() })
  ).view;
  room = (
    await f.command(cast.host, room, {
      type: 'set-capture',
      capture: broadcastAndRecord,
    })
  ).view;
  room = await everyoneReady(f, room, [cast.host, cast.guest, judge]);
  const launched = await f.command(cast.host, room, { type: 'start-round' });
  const roundId = launched.view.roundRef!.id;
  const [division] =
    await f.sql`select division from rooms where id=${room.id}`;
  // Read while it runs; then end it, so the fleet's one casual capture is free.
  const discovered = (
    await (f.store as never as BroadcastDiscovery).broadcasts.discoverUnopened(
      1000,
    )
  ).some((row) => row.roundId === roundId);
  await complete(f, roundId);
  return {
    roundId,
    roomId: room.id,
    division: division!.division as string,
    discovered,
  };
};

/** A ready casual Recording, the host's opt-in, as capture would have left it. */
const readyCasualRecording = (
  f: Fixture,
  roundId: string,
  hostActorId: string,
) => {
  const id = createId();
  const at = new Date().toISOString();
  const lifecycle = {
    status: 'ready',
    capture: {
      source: { kind: 'own_capture' },
      startedAt: at,
      attempts: [{ attempt: 1, egressId: 'EG', startedAt: at }],
      endedAt: at,
    },
    media: {
      capturedFrom: at,
      playlistKey: `recordings/${id}/hls/master.m3u8`,
      downloadKey: `recordings/${id}/video.mp4`,
      durationMs: 60_000,
      byteSize: 10,
      verifiedAt: at,
      gaps: [],
      speeches: [],
    },
  };
  return f.sql`insert into recordings (id,round_id,recording_class,eligibility,status,lifecycle)
    values (${id},${roundId},'casual',${{ kind: 'host_opt_in', hostActorId }},'ready',${lifecycle})`;
};

test('a casual Round of a Youth Room holds every Youth fence; an Open casual Round does not (ADR 0157)', async () => {
  await withRoomRuntime(async (f) =>
    withLinks(f, async (made) => {
      const database = f.store as never as Database & BroadcastDiscovery;
      const { coach, parent, owner, stranger } = await people(f);
      const youthCast = { host: f.host, guest: f.guest };
      await setAge(f, f.host, '16 years');
      await setAge(f, f.guest, '17 years');
      const judge = f.outsider;
      await setAge(f, judge, '30 years');
      const openCast = await f.freshCast();
      for (const member of [openCast.host, openCast.guest])
        await setAge(f, member, '30 years');
      const openJudge = await f.member();
      await setAge(f, openJudge, '30 years');

      const youth = await endedCasualRound(f, youthCast, judge);
      const open = await endedCasualRound(f, openCast, openJudge);
      // A Broadcast each opened before this rule shipped, released past its start.
      for (const { roundId } of [youth, open])
        await f.sql`insert into broadcasts (id, round_id, feed_key, release_policy, released_through_at)
          values (${createId()}, ${roundId}, ${createId()}, ${{ kind: 'delay', seconds: 60 }}, now() + interval '1 hour')`;
      const watchable = (roomId: string) =>
        f.store.readWatchableRoundOfRoom(
          roomId,
          spectatorClockAt(new Date(Date.now() + 600_000).toISOString()),
        );
      const live = {
        youth: await watchable(youth.roomId),
        open: await watchable(open.roomId),
      };
      // A speech released to the audience, so a follower may be told it is on air.
      for (const { roundId } of [youth, open])
        await f.sql`insert into round_segments (id,round_id,sequence,type,rules_segment_key,started_at,duration_ms)
          select ${createId()},id,0,rules_snapshot->'segments'->0->>'type',rules_snapshot->'segments'->0->>'key',
            now() - interval '10 minutes',(rules_snapshot->'segments'->0->>'durationMs')::int
          from rounds where id=${roundId}
            and not exists (select 1 from round_segments where round_id=${roundId})`;
      // A follower of each Round's host debater, swept while both are on air.
      for (const debater of [f.host, openCast.host]) {
        const [user] =
          await f.sql`select username from users where id=${debater.userId}`;
        await f.store.setDebaterFollow({
          followerUserId: stranger.userId,
          username: user!.username,
          state: 'following',
        });
      }
      await f.store.sweepNotificationFanouts({
        clock: spectatorClockAt(new Date(Date.now() + 600_000).toISOString()),
        limit: 50,
        nextId: createId,
      });
      const toldLive = (
        await f.sql`select round_id from notifications
          where user_id=${stranger.userId} and kind='followed_debater_live'`
      ).map((row: { round_id: string }) => row.round_id);
      await f.sql`delete from notifications where user_id=${stranger.userId}`;
      await f.sql`delete from notification_fanouts where round_id in (${youth.roundId}, ${open.roundId})`;
      await f.sql`delete from debater_follows where follower_user_id=${stranger.userId}`;
      const stopped = await database.broadcasts.endYouthBroadcasts(new Date());
      const [youthBroadcast] =
        await f.sql`select id from broadcasts where round_id=${youth.roundId}`;
      assert({
        given:
          'a casual Round in a Youth Room and one in an Open Room, both opted into a Broadcast',
        should:
          'open no Broadcast for the Youth one, offer no Watch link, tell no follower it is live, and stop one it already had; the Open one keeps the rest',
        actual: {
          divisions: [youth.division, open.division],
          discovered: [youth.discovered, open.discovered],
          watchLink: [live.youth, live.open],
          followerToldLive: [
            toldLive.includes(youth.roundId),
            toldLive.includes(open.roundId),
          ],
          stopped,
        },
        expected: {
          divisions: ['youth', 'open'],
          discovered: [false, true],
          watchLink: [null, open.roundId],
          followerToldLive: [false, true],
          stopped: [youthBroadcast!.id],
        },
      });

      await schoolWithCoach(f, made, { owner, coach, student: f.host });
      made.users.push(parent.userId);
      await f.sql`insert into guardian_links(id,guardian_user_id,minor_user_id,kind,status)
        values(${createId()},${parent.userId},${f.guest.userId},'parent','active')`;
      made.rounds.push(youth.roundId, open.roundId);
      await readyCasualRecording(f, youth.roundId, f.host.actorId);
      await readyCasualRecording(f, open.roundId, openCast.host.actorId);

      // The stopped Broadcast finishes, its video withheld: its seats are still
      // told the Recording is ready. A stranger who watched either Round keeps
      // only the Open one in their history.
      await f.sql`update broadcasts set completed_at=now() where round_id=${youth.roundId}`;
      await f.store.sweepNotificationFanouts({
        clock: spectatorClockAt(new Date(Date.now() + 600_000).toISOString()),
        limit: 50,
        nextId: createId,
      });
      const [readyTold] =
        await f.sql`select count(*)::int as n from notifications
        where user_id=${f.host.userId} and round_id=${youth.roundId} and kind='recording_ready'`;
      for (const { roundId } of [youth, open])
        await f.store.recordWatched({
          userId: stranger.userId,
          roundId,
          at: new Date().toISOString(),
        });
      const watched = (
        await f.store.listWatchHistory({
          userId: stranger.userId,
          clock: spectatorClockAt(new Date(Date.now() + 600_000).toISOString()),
          limit: 50,
        })
      ).map((row) => row.roundId);
      await f.sql`delete from watch_history where user_id=${stranger.userId}`;
      assert({
        given:
          'the Youth Round’s withheld Broadcast completed, and a stranger recording a visit to each Round',
        should:
          'tell its seated debater the Recording is ready, and keep only the Open Round in the stranger’s watch history',
        actual: {
          seatTold: readyTold!.n,
          watched: [youth.roundId, open.roundId].map((id) =>
            watched.includes(id),
          ),
        },
        expected: { seatTold: 1, watched: [false, true] },
      });

      const youthRound = await recordingRoundOf(database, youth.roundId);
      const openRound = await recordingRoundOf(database, open.roundId);
      const release = (roundId: string) =>
        database.readRecordingBroadcastRelease(
          roundId,
          spectatorClockAt(new Date(Date.now() + 600_000).toISOString()),
        );
      const youthRelease = await release(youth.roundId);
      const openRelease = await release(open.roundId);
      const sees = (round: RecordingRound, viewer: RecordingViewer) =>
        roundEvidencePermissions(
          round,
          round === youthRound ? youthRelease : openRelease,
          viewer,
          null,
          Date.now() + 600_000,
        ).open;
      assert({
        given:
          'the ended casual Youth-Room Round, with a coach and a parent linked',
        should:
          'open it to its debaters, judge, coach and parent only; the Open one to anyone',
        actual: {
          youth: {
            debater: sees(youthRound, viewerOf(f.host)),
            judge: sees(youthRound, viewerOf(judge)),
            coach: sees(youthRound, viewerOf(coach)),
            parent: sees(youthRound, viewerOf(parent)),
            stranger: sees(youthRound, viewerOf(stranger)),
            signedOut: sees(youthRound, { kind: 'visitor' }),
          },
          open: {
            stranger: sees(openRound, viewerOf(stranger)),
            signedOut: sees(openRound, { kind: 'visitor' }),
          },
        },
        expected: {
          youth: {
            debater: true,
            judge: true,
            coach: true,
            parent: true,
            stranger: false,
            signedOut: false,
          },
          open: { stranger: true, signedOut: true },
        },
      });

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
          .then((page) => page.rows);
      const publicRows = await archive('all', stranger.actorId);
      const ownRows = await archive('mine', f.host.actorId);
      const timeline = async (roundId: string) =>
        (await f.store.readSpectatorTimeline({
          roundId,
          horizonOf: () => Date.now() + 600_000,
        })) === null
          ? 'missing'
          : 'served';
      assert({
        given:
          'the public archive, the debater’s own list and the spectator timeline',
        should:
          'keep the Youth one out of the archive and the timeline but in its debater’s list, marked Youth; the Open one in both',
        actual: {
          publicArchive: [youth.roundId, open.roundId].map((id) =>
            publicRows.some((row) => row.id === id),
          ),
          ownList: ownRows.find((row) => row.id === youth.roundId)?.youthRound,
          timeline: [
            await timeline(youth.roundId),
            await timeline(open.roundId),
          ],
        },
        expected: {
          publicArchive: [false, true],
          ownList: true,
          timeline: ['missing', 'served'],
        },
      });

      const store = recordingPersistence({ database });
      const recordingOf = async (roundId: string) =>
        (await store.findByRound(roundId))!;
      const downloads = async (roundId: string, member: Member) =>
        openDownload(
          {
            store,
            objects: { signedRead: () => 'https://storage.test/file' },
            inputs: {
              readRound: (id) => recordingRoundOf(database, id),
              readBroadcastRelease: release,
              holdsRecordingDownload: async () => true,
            },
          },
          {
            recordingId: (await recordingOf(roundId)).id,
            viewer: viewerOf(member),
            presentedLinkHashOf: () => null,
            nowMs: Date.now() + 600_000,
          },
        ).then(
          () => 'link',
          () => 'refused',
        );
      assert({
        given: 'a subscribed debater asking to download each Recording',
        should: 'refuse the Youth one and hand out the Open one',
        actual: [
          await downloads(youth.roundId, f.host),
          await downloads(open.roundId, openCast.host),
        ],
        expected: ['refused', 'link'],
      });

      const publish = (roundId: string, member: Member) =>
        database.youthRoundPublications.publishYouthRound({
          roundId,
          userId: member.userId,
          open: true,
        });
      const refusal = (answer: Awaited<ReturnType<typeof publish>>) =>
        answer.kind === 'refused' ? answer.reason : answer.kind;
      const youthPublish = refusal(await publish(youth.roundId, f.host));
      const openPublish = refusal(await publish(open.roundId, openCast.host));
      assert({
        given: 'a debater sharing each Round publicly with no media release',
        should:
          'hold the Youth one to its releases, and find no Youth Round in the Open one',
        actual: [youthPublish, openPublish],
        expected: ['releases_missing', 'not_found'],
      });

      // The same Round had its host kept the Recording for its officials only.
      await f.sql`update rounds set capture=jsonb_set(capture,'{recordingPolicy}','"officials"') where id=${youth.roundId}`;
      const officialsOnly = refusal(await publish(youth.roundId, f.host));
      await f.sql`update rounds set capture=jsonb_set(capture,'{recordingPolicy}','"released"') where id=${youth.roundId}`;
      assert({
        given: 'a casual Youth Round whose Recording is kept for its officials',
        should: 'never be shared publicly, whatever releases it holds',
        actual: officialsOnly,
        expected: 'not_available',
      });

      // Shared by a debater, with publishing open: listed publicly although the
      // Broadcast it opened before the rule was withheld (ADR 0157).
      await f.sql`insert into youth_round_publications (round_id, published_by_user_id, published_at)
        values (${youth.roundId}, ${f.host.userId}, now())`;
      const sharedRows = await database
        .listRecordingArchive({
          query: {
            scope: 'all',
            mode: 'any',
            q: '',
            sort: 'newest',
            before: '',
          },
          viewerActorId: stranger.actorId,
          clock,
          limit: 100,
          youthPublishing: true,
        })
        .then((page) => page.rows.map((row) => row.id));
      await f.sql`delete from youth_round_publications where round_id=${youth.roundId}`;
      assert({
        given: 'the casual Youth Round shared, its pre-rule Broadcast withheld',
        should: 'list it in the public archive while publishing is open',
        actual: sharedRows.includes(youth.roundId),
        expected: true,
      });

      const takeDown = async (member: Member, roundId: string) => {
        const recording = await recordingOf(roundId);
        return requestParticipantRemoval(
          {
            store,
            inputs: { readRound: (id) => recordingRoundOf(database, id) },
          },
          {
            recordingId: recording.id,
            expectedVersion: recording.version,
            viewer: viewerOf(member),
            now: new Date().toISOString(),
          },
        );
      };
      await assertRejects({
        given: 'the adult judge of a casual Youth-Room Round',
        should: 'refuse the takedown, as on any Youth Round',
        actual: () => takeDown(judge, youth.roundId),
        code: 'AUTHORIZATION',
      });
      await assertRejects({
        given: 'a stranger',
        should: 'refuse the takedown',
        actual: () => takeDown(stranger, youth.roundId),
        code: 'AUTHORIZATION',
      });
      assert({
        given: 'a youth debater’s parent, then the Open Round’s judge',
        should:
          'take the Youth Recording down, and let the Open judge remove theirs as any casual participant',
        actual: [
          (await takeDown(parent, youth.roundId)).lifecycle.status,
          (await takeDown(openJudge, open.roundId)).lifecycle.status,
        ],
        expected: ['removing', 'removing'],
      });
    }),
  );
});
