import { eventBallotAccess } from '../src/features/round-ballots/audience';
import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { seedRatingSeason } from '@daisy/db/testing';
import {
  captureRule,
  RANKED_DELAY_SECONDS,
  readRoundOpening,
  roundWaitingOn,
  tallyRecord,
} from '@daisy/debate-engine';
import { SPECTATOR_MARGIN_MS } from '@daisy/protocol/broadcast';
import { sideSeat } from '@daisy/protocol/seats';
import { spectatorTimelineSchema } from '@daisy/protocol/spectator-timeline';
import { winnerOutcome, winningSideOf } from '@daisy/protocol/round-outcome';
import { type RoundStatus } from '@daisy/protocol/round';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readLadder } from '../src/features/leaderboard/read-leaderboard';
import { readNotificationItems } from '../src/features/notifications/read-notifications';
import { audienceLinkHash } from '../src/features/audience-link/audience-link';
import { readProfile } from '../src/features/profile/read-profile';
import { readMemberStandings } from '../src/features/ratings/read-member';
import { canReadRound } from '../src/features/round-runtime/reads';
import {
  createWatchRoundSnapshots,
  readWatchRound,
} from '../src/features/spectating/read-timeline';
import { presentedLinkHash } from '../src/features/audience-link/audience-link';
import { spectatorClockAt } from '../src/features/spectating/spectator-clock';
import { listLive } from '../src/features/watch/list-live';
import {
  cachedAiJudgingRuntime,
  frozenRankedRound,
  recoverRankedResults,
} from './ranked-room.test-support';
import { fixtureBallot, submitHumanBallot } from './round-judging.test-support';
import { withRoomRuntime } from './round-runtime.test-support';
import { deleteOrphanNotificationSignals } from './notification-signals.test-support';

setupRitewayBun();
requireTestServices(process.env);

const REASON = 'An outcome-bearing reason nobody may read early';
const FEEDBACK = 'Private feedback for the affirmative alone';
const visitor = {
  state: 'anonymous',
  principal: { kind: 'anonymous' },
} as const;
const limiter = {
  consume: async () => ({ allowed: true, retryAfterSeconds: 0 }),
} as never;

test('every public and member read holds a ranked outcome until release', async () => {
  await withRoomRuntime(async (f) => {
    const seasonId = createId();
    const follower = createId();
    let roundId: string | undefined;
    const openRoomId = createId();
    const assemblingRoomId = createId();
    const casualRoomId = createId();
    const previousSeasonId = createId();
    const discoveryTitle = `Starting ranked ${createId()}`;
    try {
      const season = await seedRatingSeason(f.sql, seasonId);
      const frozen = await frozenRankedRound(f, 'freestyle', 'human');
      roundId = frozen.roundId;
      const ballot = {
        ...fixtureBallot(REASON, 'affirmative'),
        feedback: { affirmative: FEEDBACK },
      };
      await submitHumanBallot(
        f,
        roundId,
        f.outsider.actorId,
        frozen.freezeRevision,
        ballot,
      );
      await recoverRankedResults(f);
      await f.sql`insert into broadcasts (id, round_id, feed_key, release_policy)
        values (${createId()}, ${roundId}, ${createId()}, ${{ kind: 'delay', seconds: RANKED_DELAY_SECONDS }})`;
      const [ended] =
        (await f.sql`select completed_at, resolution, ladder_id from rounds where id=${roundId}`) as {
          completed_at: Date;
          resolution: string;
          ladder_id: string;
        }[];
      const {
        completed_at: completedAt,
        resolution,
        ladder_id: ladderId,
      } = ended!;
      // Long past the delay by the clock: only the watermark can release.
      const now = new Date(
        completedAt.getTime() + 1000 * RANKED_DELAY_SECONDS * 100,
      ).toISOString();
      const hostName = `u-${f.host.userId}`;
      // No seat in this Round: the fixture's outsider judges it.
      const stranger = { userId: createId(), actorId: createId() };
      await f.sql`insert into users (id,username) values (${follower},${`u-${follower}`})`;
      await f.sql`insert into debater_follows (follower_user_id,debater_actor_id)
        values (${follower},${f.host.actorId})`;
      const followerNotifications = async () => {
        const now = new Date().toISOString();
        await f.store.sweepNotificationFanouts({
          clock: spectatorClockAt(now),
          limit: 50,
          nextId: createId,
        });
        return readNotificationItems(f.store, {
          userId: follower,
          query: { unreadOnly: false, after: null },
          now,
        });
      };

      const timelineResponse = async (cookie?: string) => {
        const watched = await readWatchRound(
          {
            snapshots: createWatchRoundSnapshots({
              store: f.store,
              clock: { now: () => now },
              feedUrlOf: () => null,
            }),
            store: f.store,
            publicOrigin: undefined,
          },
          {
            roundId: roundId!,
            presentedHash: presentedLinkHash(cookie ?? null, roundId!),
          },
        );
        return watched
          ? Response.json(watched.timeline)
          : Response.json({}, { status: 404 });
      };
      await f.sql`insert into seasons (id,lobby_id,organization_id,name,starts_at,ends_at,status)
        select ${previousSeasonId},lobby_id,organization_id,'Previous season','2000-01-01','2000-02-01','closed'
        from seasons where id=${season.id}`;
      await f.sql`insert into ratings (actor_id,season_id,ladder,lobby_id,rating,deviation,volatility)
        values (${f.host.actorId},${previousSeasonId},${ladderId},${season.lobbyId},2200,100,0.06)`;
      // The shard's three Room shapes, with a real first posting in the active season.
      for (const [id, status, mode] of [
        [openRoomId, 'ready', 'ranked'],
        [assemblingRoomId, 'assembling', 'ranked'],
        [casualRoomId, 'ready', 'casual'],
      ] as const)
        await f.sql`insert into rooms (lobby_id,id,host_actor_id,title,topic,visibility,format_id,format_version,preset_version,competition_type,config,execution_plan,rules_snapshot,status)
          select lobby_id,${id},host_actor_id,${discoveryTitle},null,'public',format_id,format_version,
            case when ${mode}='ranked' then preset_version end,${mode},config,execution_plan,rules_snapshot,${status}
          from rooms where id=${frozen.room.id}`;
      await f.sql`insert into room_participants (id,room_id,actor_id,seat_kind,side,slot)
        values (${createId()},${openRoomId},${f.host.actorId},'side','affirmative',0)`;
      const listedRating = async () => {
        const page = await f.operations.list(f.outsider, {
          pageSize: 20,
          q: discoveryTitle,
          status: 'starting',
          mode: 'ranked',
          lobbyId: season.lobbyId,
        });
        return page.rooms.map((r) => [
          r.id,
          r.status,
          r.competitionType,
          r.hostRating,
        ]);
      };
      const ledger =
        (await f.sql`select rating_before, rating_after from rating_changes
        where round_id=${roundId} and actor_id=${f.host.actorId}`) as {
          rating_before: number;
          rating_after: number;
        }[];
      const personCard = async () => {
        const cards = await f.store.readMemberCards(
          [f.host.actorId],
          spectatorClockAt(now),
        );
        const { wins, losses } = tallyRecord(
          cards.records.map(({ status, outcome, seat, rounds }) => ({
            status: status as RoundStatus,
            outcome,
            seat,
            rounds,
          })),
        );
        return {
          rating: cards.ratings.find((r) => r.ladder === 'freestyle')?.rating,
          lastRatedAt: cards.ratings.find((r) => r.ladder === 'freestyle')
            ?.lastRatedAt,
          wins,
          losses,
        };
      };
      const [{ side: ledgerSide }] =
        (await f.sql`select side from round_participants
        where round_id=${roundId} and actor_id=${f.host.actorId}`) as [
          { side: string },
        ];
      const emptyRecord = tallyRecord([]);
      const reads = async () => {
        const response = await timelineResponse();
        const body = await response.text();
        const timeline = spectatorTimelineSchema.parse(JSON.parse(body));
        const ladder = await readLadder(f.store, {
          seasonId: season.id,
          ladder: { style: 'freestyle', division: 'open' },
          now,
          username: null,
        });
        const member = await readMemberStandings(f.store, {
          username: hostName,
          now,
        });
        const profile = await readProfile(
          { store: f.store, limiter, wearsPremiumMark: async () => false },
          { identity: visitor, username: hostName, query: {}, now },
        );
        return {
          listedRating: await listedRating(),
          body,
          response,
          timeline,
          ladderEntries: (ladder?.data.entries ?? []).filter(
            (e) => e.id === f.host.actorId,
          ).length,
          memberStanding: member.find(
            (m) =>
              m.ladder.style === 'freestyle' && m.ladder.division === 'open',
          ),
          historyRows: profile?.history.length,
          profileRecord: profile?.record,
          card: await personCard(),
        };
      };

      const held = await reads();
      assert({
        given: 'no media released, long after the Round by the clock',
        should: 'give the audience a slate with no outcome, ballot or caption',
        actual: {
          stage: held.timeline.stage,
          result: held.timeline.result,
          captions: held.timeline.captions,
        },
        expected: {
          stage: { kind: 'slate', moment: 'unreleased' },
          result: null,
          captions: [],
        },
      });
      assert({
        given: 'the snapshot body before release',
        should: 'carry no reason, feedback or drawn resolution text',
        actual: [REASON, FEEDBACK, resolution].map((text) =>
          held.body.includes(text),
        ),
        expected: [false, false, false],
      });
      assert({
        given: 'ratings, standings and the leaderboard before release',
        should:
          'keep the active season unrated and exclude the unposted past projection',
        actual: [
          held.ladderEntries,
          held.memberStanding?.current,
          held.memberStanding?.rating,
        ],
        expected: [0, true, null],
      });
      assert({
        given:
          'starting ranked discovery before the host’s first current-season posting is released',
        should: 'list only the ready ranked Room and keep its host unrated',
        actual: held.listedRating,
        expected: [[openRoomId, 'ready', 'ranked', null]],
      });
      assert({
        given: 'a public profile before release',
        should: 'list no Round and tally none',
        actual: [held.historyRows, held.profileRecord],
        expected: [0, emptyRecord],
      });
      assert({
        given: 'the people rail and /api/people before release',
        should: 'show the debater unrated, with no win or loss from the Round',
        actual: held.card,
        expected: {
          rating: undefined,
          lastRatedAt: undefined,
          wins: 0,
          losses: 0,
        },
      });
      assert({
        given: 'a follower of a seated debater, after a sweep, before release',
        should: 'store no notification, so none can say anything early',
        actual: await followerNotifications(),
        expected: { items: [], unread: 0, next: null },
      });
      const round = await f.store.readLaunchedRound(
        roundId,
        f.host,
        () => true,
        readRoundOpening,
        roundWaitingOn,
        () => false,
      );
      assert({
        given: 'an account with no seat in the Round',
        should: 'hold no Round read, so its APIs and sockets refuse',
        actual: canReadRound(
          stranger,
          { ...round, hostActorId: f.host.actorId } as never,
          {
            member: true,
            erased: false,
          } as never,
          { kind: 'ordinary', checkedAt: new Date().toISOString() },
        ),
        expected: false,
      });
      await assertRejects({
        given: 'the ballots API as an account with no seat',
        should: 'answer as if the Round did not exist',
        actual: () =>
          f.store.readRoundBallot({
            ballotAccess: (_round, _account, owner) =>
              eventBallotAccess(stranger, owner),
            roundId: roundId!,
            caller: stranger,
            authorize: (r, account, authority) =>
              canReadRound(stranger, r, account as never, authority),
            authorizeTranscript: () => false,
            decideWaitingOn: roundWaitingOn,
            readOpening: readRoundOpening,
            captureRule,
          }),
        code: 'NOT_FOUND',
      });

      await f.sql`update broadcasts b set released_through_at=r.started_at
        + ${SPECTATOR_MARGIN_MS}::int * interval '1 millisecond'
        from rounds r where b.round_id=r.id and r.id=${roundId}`;
      try {
        await f.sql`update lobbies set age_rule='under-18' where id=${season.lobbyId}`;
        const live = await listLive(f.store, {
          query: {
            tab: 'live',
            mode: 'ranked',
            q: '',
            lobby: season.lobbyId,
            before: '',
          },
          now,
        });
        assert({
          given:
            'a public ranked broadcast after its lobby changes to under-18',
          should: 'list the frozen Open ladder while the broadcast is live',
          actual: [live.featured, ...live.rows].find(
            (row) => row?.id === roundId,
          )?.ladder,
          expected: { style: 'freestyle', division: 'open' },
        });
      } finally {
        await f.sql`update lobbies set age_rule='adults' where id=${season.lobbyId}`;
      }
      await f.sql`update broadcasts set released_through_at=${new Date(
        completedAt.getTime() + SPECTATOR_MARGIN_MS,
      )} where round_id=${roundId}`;
      const out = await reads();
      const heard = await followerNotifications();
      assert({
        given: 'the follower once the Broadcast has released media',
        should:
          'store one notification saying the debater is on air, and nothing of the result',
        actual: {
          text: heard.items.map((item) => item.text),
          leaks: [REASON, FEEDBACK].some((secret) =>
            JSON.stringify(heard).includes(secret),
          ),
        },
        expected: { text: [`@${hostName} is on air.`], leaks: false },
      });
      await f.sql`update broadcasts set released_through_at=${completedAt}, stopped_at=${completedAt}, stop_reason='technical' where round_id=${roundId}`;
      const stopped = await reads();
      assert({
        given:
          'a stopped Broadcast short of the outcome, long after by the clock',
        should:
          'end the timeline with no result, while the competitive record still stands',
        actual: {
          stage: stopped.timeline.stage,
          result: stopped.timeline.result,
          ladderEntries: stopped.ladderEntries,
        },
        expected: {
          stage: { kind: 'ended' },
          result: null,
          ladderEntries: 1,
        },
      });
      const token = 'A'.repeat(43);
      await f.sql`update rounds set visibility='unlisted', audience_link_hash=${audienceLinkHash(token)} where id=${roundId}`;
      const noLink = await timelineResponse();
      const unlisted = await timelineResponse(
        `daisy_audience_link_${roundId}=${token}`,
      );
      await f.sql`update rounds set visibility='private', audience_link_hash=null where id=${roundId}`;
      const hidden = await timelineResponse();
      await f.sql`update rounds set visibility='public' where id=${roundId}`;
      assert({
        given:
          'an unlisted Round with no link, then by its link, then a private Round',
        should: 'admit only the link, and no audience to the last',
        actual: [noLink.status, unlisted.status, hidden.status],
        expected: [404, 200, 404],
      });
      assert({
        given: 'the watermark past the outcome by the margin',
        should:
          'release winner, scores, reason and ratings, on a cacheable answer',
        actual: {
          stage: out.timeline.stage,
          winner: winningSideOf(out.timeline.result?.outcome ?? null),
          reasons: out.timeline.result?.ballots.map((b) => b.reason),
          ratings: out.timeline.result?.ratings.length,
        },
        expected: {
          stage: { kind: 'ended' },
          winner: 'affirmative',
          reasons: [REASON],
          ratings: 2,
        },
      });
      assert({
        given: 'a released ballot',
        should: 'never carry side feedback or name the judge',
        actual: [
          out.body.includes(FEEDBACK),
          out.body.includes(f.outsider.actorId),
          out.body.includes(`u-${f.outsider.userId}`),
          out.timeline.resolution === resolution,
        ],
        expected: [false, false, false, true],
      });
      assert({
        given:
          'the same starting ranked discovery after release, with past and current ratings',
        should:
          'list only the ready ranked Room with the rounded current-season Freestyle value',
        actual: out.listedRating,
        expected: [
          [openRoomId, 'ready', 'ranked', Math.round(ledger[0]!.rating_after)],
        ],
      });
      assert({
        given: 'ratings, standings and profiles after release',
        should: 'show the rated Round',
        actual: [
          out.ladderEntries,
          out.memberStanding?.current,
          out.memberStanding?.rating,
          out.historyRows,
        ],
        expected: [1, true, Math.round(ledger[0]!.rating_after), 1],
      });
      assert({
        given: 'the profile tally after release',
        should: 'count the Round',
        actual: out.profileRecord,
        expected: tallyRecord([
          {
            status: 'completed',
            outcome: winnerOutcome('affirmative'),
            seat: sideSeat(ledgerSide),
            rounds: 1,
          },
        ]),
      });
      assert({
        given: 'the people rail and /api/people after release',
        should: 'show the rating and the result the Round left',
        actual: {
          rating: out.card.rating,
          record: [out.card.wins, out.card.losses],
        },
        expected: {
          rating: ledger[0]!.rating_after,
          record: ledgerSide === 'affirmative' ? [1, 0] : [0, 1],
        },
      });
      try {
        await f.sql`update lobbies set age_rule='under-18' where id=${season.lobbyId}`;
        const [launched, memberHistory] = await Promise.all([
          f.store.readLaunchedRound(
            roundId,
            f.host,
            () => true,
            readRoundOpening,
            roundWaitingOn,
            () => false,
          ),
          f.store.readMemberProfile({
            username: hostName,
            caller: null,
            decide: () => 'public',
            before: null,
            limit: 20,
            clock: spectatorClockAt(now),
          }),
        ]);
        assert({
          given: 'a released Open result after its lobby changes to under-18',
          should:
            'show its frozen Open ladder in live Round details and member history',
          actual: [
            launched.ladder,
            memberHistory?.rows.find((row) => row.roundId === roundId)?.ladder,
          ],
          expected: Array(2).fill({ style: 'freestyle', division: 'open' }),
        });
      } finally {
        await f.sql`update lobbies set age_rule='adults' where id=${season.lobbyId}`;
      }
    } finally {
      await f.sql`delete from room_participants where room_id=${openRoomId}`;
      await f.sql`delete from rooms where id in (${openRoomId},${assemblingRoomId},${casualRoomId})`;
      await deleteOrphanNotificationSignals(f.sql);
      await f.sql`delete from users where id=${follower}`;
      if (roundId) {
        await f.sql`delete from notifications where round_id=${roundId}`;
        await f.sql`delete from notification_fanouts where round_id=${roundId}`;
        await f.sql`delete from broadcasts where round_id=${roundId}`;
        await f.sql`delete from rating_changes where round_id=${roundId}`;
      }
      await f.sql`delete from ratings where actor_id in (${f.host.actorId},${f.guest.actorId})`;
      await f.sql`delete from agreement_signatures where season_id=${seasonId}`;
      f.afterRooms(async () => {
        await f.sql`delete from seasons where id in (${seasonId},${previousSeasonId})`;
      });
    }
  }, cachedAiJudgingRuntime);
});
