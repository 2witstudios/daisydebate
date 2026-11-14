import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { withSeasons } from '@daisy/db/seasons';
import {
  captureRule,
  RANKED_DELAY_SECONDS,
  readRoundOpening,
  roundWaitingOn,
  tallyRecord,
} from '@daisy/debate-engine';
import {
  SPECTATOR_MARGIN_MS,
  spectatorTimelineSchema,
  type DebateRole,
  type RoundOutcome,
  type RoundStatus,
} from '@daisy/protocol';
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
import {
  cachedAiJudgingRuntime,
  frozenRankedRound,
  recoverRankedResults,
} from './ranked-room.test-support';
import { fixtureBallot, submitHumanBallot } from './round-judging.test-support';
import { withRoomRuntime } from './round-runtime.test-support';

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
    try {
      const season = await withSeasons(process.env['TEST_DATABASE_URL']!, (s) =>
        s.activateBetaSeason({ id: seasonId }),
      );
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
        (await f.sql`select completed_at, resolution from rounds where id=${roundId}`) as {
          completed_at: Date;
          resolution: string;
        }[];
      const { completed_at: completedAt, resolution } = ended!;
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
          unreadOnly: false,
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
      // A Room the rated host opens while the Round is still held.
      const openRoomId = createId();
      await f.sql`insert into rooms (lobby_id,id,host_actor_id,title,topic,visibility,format_id,format_version,preset_version,competition_type,config,execution_plan,rules_snapshot,status)
        select lobby_id,${openRoomId},host_actor_id,title,null,'public',format_id,format_version,preset_version,competition_type,config,execution_plan,rules_snapshot,'assembling'
        from rooms where id=${frozen.room.id}`;
      const listedRating = async () => {
        const page = await f.store.listRoomPage(
          f.outsider,
          { pageSize: 50, q: '' },
          () => true,
          () => true,
          () => false,
          spectatorClockAt(now),
          () => null,
        );
        return page.rooms.find((r) => r.id === openRoomId)?.hostRating;
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
          cards.records.map(({ status, outcome, role, rounds }) => ({
            status: status as RoundStatus,
            outcome: outcome as RoundOutcome | null,
            role: role as DebateRole,
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
      const [{ role: ledgerRole }] =
        (await f.sql`select role from round_participants
        where round_id=${roundId} and actor_id=${f.host.actorId}`) as [
          { role: DebateRole },
        ];
      const emptyRecord = tallyRecord([]);
      const reads = async () => {
        const response = await timelineResponse();
        const body = await response.text();
        const timeline = spectatorTimelineSchema.parse(JSON.parse(body));
        const ladder = await readLadder(f.store, {
          seasonId: season.id,
          ladder: 'freestyle',
          now,
          username: null,
        });
        const member = await readMemberStandings(f.store, {
          username: hostName,
          now,
        });
        const profile = await readProfile(
          { store: f.store, limiter },
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
          memberRating: member.find((m) => m.ladder === 'freestyle')?.rating,
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
        should: 'not show the debater as rated',
        actual: [held.ladderEntries, held.memberRating],
        expected: [0, null],
      });
      assert({
        given: 'a Room listing the host before release',
        should: 'show the rating from before the held Round',
        actual: held.listedRating,
        expected: Math.round(ledger[0]!.rating_before),
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
        expected: { items: [], unread: 0 },
      });
      const round = await f.store.readLaunchedRound(
        roundId,
        f.host,
        () => true,
        readRoundOpening,
        roundWaitingOn,
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
        ),
        expected: false,
      });
      await assertRejects({
        given: 'the ballots API as an account with no seat',
        should: 'answer as if the Round did not exist',
        actual: () =>
          f.store.readRoundBallot({
            roundId: roundId!,
            caller: stranger,
            authorize: (r, account) =>
              canReadRound(stranger, r, account as never),
            authorizeTranscript: () => false,
            decideWaitingOn: roundWaitingOn,
            readOpening: readRoundOpening,
            captureRule,
          }),
        code: 'NOT_FOUND',
      });

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
          winner: out.timeline.result?.winner,
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
        given: 'a Room listing the host after release',
        should: 'show the rating the Round left',
        actual: out.listedRating,
        expected: Math.round(ledger[0]!.rating_after),
      });
      assert({
        given: 'ratings, standings and profiles after release',
        should: 'show the rated Round',
        actual: [out.ladderEntries, out.memberRating !== null, out.historyRows],
        expected: [1, true, 1],
      });
      assert({
        given: 'the profile tally after release',
        should: 'count the Round',
        actual: out.profileRecord,
        expected: tallyRecord([
          {
            status: 'completed',
            outcome: 'affirmative',
            role: ledgerRole,
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
          record: ledgerRole === 'affirmative' ? [1, 0] : [0, 1],
        },
      });
      await f.sql`delete from rooms where id=${openRoomId}`;
    } finally {
      await f.sql`delete from users where id=${follower}`;
      if (roundId) {
        await f.sql`delete from notifications where round_id=${roundId}`;
        await f.sql`delete from notification_fanouts where round_id=${roundId}`;
        await f.sql`delete from broadcasts where round_id=${roundId}`;
        await f.sql`delete from rating_changes where round_id=${roundId}`;
      }
      await f.sql`delete from ratings where actor_id in (${f.host.actorId},${f.guest.actorId})`;
      await f.sql`delete from agreement_signatures where season_id=${seasonId}`;
      await f.sql`delete from seasons where id=${seasonId}`;
    }
  }, cachedAiJudgingRuntime);
});
