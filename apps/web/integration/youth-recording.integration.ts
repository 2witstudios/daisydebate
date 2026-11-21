import { seedGuardianLink } from './guardian-link.test-support';
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
import { readAudienceForViewer } from '../src/features/spectating/audience-snapshot';
import { readAudienceSnapshot } from '../src/features/spectating/read-timeline';
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
 * ADR 0161: a Youth Round is viewed by Open's rules, against the real database
 * and its row-level security: a ranked one is public to anyone, live and in
 * the archive. Its youth debaters' linked coaches and parents see through a
 * private or unlisted Room, until their link lapses. Its Recording is reused
 * (downloaded) only once every youth debater holds a release.
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
    // As the web composes it: the Round's own youth fact decides (ADR 0157).
    youth: round.youthRound
      ? await database.readYouthRoundPeople(roundId)
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

test('a ranked Youth Round is public as an Open one is, and its linked adults see through private', async () => {
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
        await seedGuardianLink(f.sql, parent.userId, f.guest.userId);
        await f.sql`update rounds set status='completed', current_stage=null, started_at=coalesce(started_at, now()), winning_side='affirmative', completed_at=now() where id=${roundId}`;
        const [division] =
          await f.sql`select ladder_division from rounds where id=${roundId}`;
        const round = await recordingRoundOf(database, roundId);
        // Read past the ranked delay, as the audience reads it.
        const later = Date.now() + 600_000;
        const release = await database.readRecordingBroadcastRelease(
          roundId,
          spectatorClockAt(new Date(later).toISOString()),
        );
        const sees = (viewer: RecordingViewer, input: RecordingRound = round) =>
          roundEvidencePermissions(input, release, viewer, null, later).media;
        assert({
          given:
            'a ranked Youth Round with a school coach and a parent linked to its debaters',
          should:
            'show it to everyone, signed out included, and discover its Broadcast',
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
            broadcastDiscovered: true,
            debater: true,
            judge: true,
            coach: true,
            parent: true,
            schoolOwner: true,
            stranger: true,
            signedOut: true,
          },
        });
        // The same people read on a private Room's Round: the bypass alone admits.
        const hidden = { ...round, visibility: 'private' as const };
        assert({
          given: 'the same Round read as private',
          should:
            'show it to its seats and linked adults, and to no stranger or visitor',
          actual: [f.host, coach, parent, owner, stranger]
            .map((member) => sees(viewerOf(member), hidden))
            .concat(sees({ kind: 'visitor' }, hidden)),
          expected: [true, true, true, true, false, false],
        });

        await f.sql`update grants set revoked_at=now(), revoked_by_user_id=${owner.userId} where id=${school.grantId}`;
        await f.sql`update guardian_links set status='ended', closed_at=now() where guardian_user_id=${parent.userId}`;
        const lapsed = {
          ...(await recordingRoundOf(database, roundId)),
          visibility: 'private' as const,
        };
        assert({
          given:
            'the coach’s grant revoked and the parent’s link ended, on a private Round',
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
          should: 'list it in both, as an Open ranked Round',
          actual: {
            publicArchive: await archive('all', stranger.actorId),
            ownList: await archive('mine', f.host.actorId),
          },
          expected: { publicArchive: true, ownList: true },
        });

        // A follower of a youth debater is told of the Recording, as of any public one.
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
          should: 'tell the debater and the follower',
          actual: {
            debater: await told(f.host),
            follower: await told(stranger),
          },
          expected: { debater: true, follower: true },
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
        await seedGuardianLink(f.sql, parent.userId, f.guest.userId);
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
  const [classification] =
    await f.sql`select public.daisy_room_is_youth(${room.id}) as youth`;
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
    division: classification!.youth ? 'youth' : 'open',
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

test('a public casual Round of a Youth Room is read exactly as an Open one, but its reuse and takedown (ADR 0161)', async () => {
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
      // A Broadcast each opened, released past its start.
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
      // The spectator audience (chat, reactions, snapshot) reads both alike.
      const audience = async (roundId: string) =>
        (await readAudienceForViewer(
          { store: f.store as never },
          { roundId, actorId: stranger.actorId, presentedHash: null },
        )) === null
          ? 'none'
          : 'read';
      assert({
        given: 'a stranger reading the spectator audience of each Round',
        should: 'read both, as Open rules say for a public Room',
        actual: {
          youth: await audience(youth.roundId),
          open: await audience(open.roundId),
        },
        expected: { youth: 'read', open: 'read' },
      });
      // Watch offers Stream this Round only past the reuse fence (ADR 0161).
      const streamable = async (roundId: string) =>
        (
          await readAudienceSnapshot(f.store as never, {
            roundId,
            now: new Date(Date.now() + 600_000).toISOString(),
            feedUrlOf: () => 'https://feed.test/master.m3u8',
          })
        )?.streamable;
      assert({
        given: 'the Watch snapshot of each public casual Round',
        should: 'offer the Open one to streamers and fence the Youth one',
        actual: {
          youth: await streamable(youth.roundId),
          open: await streamable(open.roundId),
        },
        expected: { youth: false, open: true },
      });
      assert({
        given:
          'a public casual Round in a Youth Room and one in an Open Room, both opted into a Broadcast',
        should:
          'discover both Broadcasts, offer both Watch links and tell a follower each is live',
        actual: {
          divisions: [youth.division, open.division],
          discovered: [youth.discovered, open.discovered],
          watchLink: [live.youth, live.open],
          followerToldLive: [
            toldLive.includes(youth.roundId),
            toldLive.includes(open.roundId),
          ],
        },
        expected: {
          divisions: ['youth', 'open'],
          discovered: [true, true],
          watchLink: [youth.roundId, open.roundId],
          followerToldLive: [true, true],
        },
      });

      await schoolWithCoach(f, made, { owner, coach, student: f.host });
      made.users.push(parent.userId);
      await seedGuardianLink(f.sql, parent.userId, f.guest.userId);
      made.rounds.push(youth.roundId, open.roundId);
      await readyCasualRecording(f, youth.roundId, f.host.actorId);
      await readyCasualRecording(f, open.roundId, openCast.host.actorId);

      await f.sql`update broadcasts set final_media_end_at=now()-interval '3 minutes',stream_ended_at=now(),completed_at=now() where round_id in (${youth.roundId}, ${open.roundId})`;
      await f.store.sweepNotificationFanouts({
        clock: spectatorClockAt(new Date(Date.now() + 600_000).toISOString()),
        limit: 50,
        nextId: createId,
      });
      const readyTold = (
        await f.sql`select round_id from notifications
          where user_id=${stranger.userId} and kind='recording_ready'`
      ).map((row: { round_id: string }) => row.round_id);
      await f.sql`delete from notifications where user_id=${stranger.userId}`;
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
      await f.sql`delete from debater_follows where follower_user_id=${stranger.userId}`;
      assert({
        given:
          'both Recordings ready, a follower of each host debater, and a stranger’s visit to each',
        should:
          'tell the follower of both Recordings and keep both in the stranger’s watch history',
        actual: {
          followerTold: [youth.roundId, open.roundId].map((id) =>
            readyTold.includes(id),
          ),
          watched: [youth.roundId, open.roundId].map((id) =>
            watched.includes(id),
          ),
        },
        expected: { followerTold: [true, true], watched: [true, true] },
      });

      const release = (roundId: string) =>
        database.readRecordingBroadcastRelease(
          roundId,
          spectatorClockAt(new Date(Date.now() + 600_000).toISOString()),
        );
      const sees = async (roundId: string, viewer: RecordingViewer) => {
        const round = await recordingRoundOf(database, roundId);
        const permissions = (input: RecordingRound) =>
          roundEvidencePermissions(
            input,
            releases[roundId]!,
            viewer,
            null,
            Date.now() + 600_000,
          ).open;
        return {
          asIs: permissions(round),
          private: permissions({ ...round, visibility: 'private' }),
        };
      };
      const releases: Record<string, Awaited<ReturnType<typeof release>>> = {
        [youth.roundId]: await release(youth.roundId),
        [open.roundId]: await release(open.roundId),
      };
      assert({
        given:
          'the ended casual Rounds, public as played and read again as private, with a coach and a parent linked to the youth debaters',
        should:
          'open both to anyone while public; when private, the Youth one to its debater, coach and parent only, the Open one to its seats only',
        actual: {
          youth: {
            debater: await sees(youth.roundId, viewerOf(f.host)),
            coach: await sees(youth.roundId, viewerOf(coach)),
            parent: await sees(youth.roundId, viewerOf(parent)),
            stranger: await sees(youth.roundId, viewerOf(stranger)),
            signedOut: await sees(youth.roundId, { kind: 'visitor' }),
          },
          open: {
            debater: await sees(open.roundId, viewerOf(openCast.host)),
            coach: await sees(open.roundId, viewerOf(coach)),
            stranger: await sees(open.roundId, viewerOf(stranger)),
          },
        },
        expected: {
          youth: {
            debater: { asIs: true, private: true },
            coach: { asIs: true, private: true },
            parent: { asIs: true, private: true },
            stranger: { asIs: true, private: false },
            signedOut: { asIs: true, private: false },
          },
          open: {
            debater: { asIs: true, private: true },
            coach: { asIs: true, private: false },
            stranger: { asIs: true, private: false },
          },
        },
      });

      const clock = spectatorClockAt(
        new Date(Date.now() + 600_000).toISOString(),
      );
      const publicRows = await database
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
        })
        .then((page) => page.rows);
      const timeline = async (roundId: string) =>
        (await f.store.readSpectatorTimeline({
          roundId,
          horizonOf: () => Date.now() + 600_000,
        })) === null
          ? 'missing'
          : 'served';
      assert({
        given: 'the public archive and the spectator timeline',
        should: 'list and serve both Rounds alike',
        actual: {
          publicArchive: [youth.roundId, open.roundId].map((id) =>
            publicRows.some((row) => row.id === id),
          ),
          timeline: [
            await timeline(youth.roundId),
            await timeline(open.roundId),
          ],
        },
        expected: {
          publicArchive: [true, true],
          timeline: ['served', 'served'],
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
              // As the web composes it: the SQL fence, one statement.
              readReuseFenced: database.readRoundReuseFenced,
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
      const unreleased = [
        await downloads(youth.roundId, stranger),
        await downloads(open.roundId, stranger),
      ];
      for (const minor of [f.host, f.guest])
        await f.sql`insert into media_releases (id,user_id,scope,source,signer_name,signer_relation,signer_email,wording_version,signed_at)
          values (${createId()},${minor.userId},'publish','parent','A Parent','parent','parent@example.test','2026-11-v2',now())`;
      const released = await downloads(youth.roundId, stranger);
      await f.sql`delete from media_releases where user_id in (${f.host.userId}, ${f.guest.userId})`;
      assert({
        given:
          'a subscribed stranger downloading each Recording, then the Youth one once both youth debaters hold a release',
        should:
          'refuse the Youth one until every youth debater released it, and hand out the Open one',
        actual: { unreleased, released },
        expected: { unreleased: ['refused', 'link'], released: 'link' },
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
