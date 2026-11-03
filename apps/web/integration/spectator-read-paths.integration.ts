import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { withSeasons } from '@daisy/db/seasons';
import { RANKED_DELAY_SECONDS } from '@daisy/debate-engine';
import { SPECTATOR_MARGIN_MS, spectatorTimelineSchema } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readLadder } from '../src/features/leaderboard/read-leaderboard';
import { getNotifications } from '../src/features/notifications/get-notifications';
import { readProfile } from '../src/features/profile/read-profile';
import { readMemberStandings } from '../src/features/ratings/read-member';
import { canReadRound } from '../src/features/round-runtime/reads';
import { createSpectatorTimelineHandlers } from '../src/features/spectating/handlers';
import { PUBLIC_SNAPSHOT_CACHE } from '../src/server/http';
import { silentLogger } from '../src/server/test-loggers.test-support';
import { noopErrorReporter } from '@daisy/observability';
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
      await f.sql`insert into broadcasts (id, round_id, release_policy)
        values (${createId()}, ${roundId}, ${{ kind: 'delay', seconds: RANKED_DELAY_SECONDS }})`;
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

      const timelineResponse = async () => {
        const fresh = createSpectatorTimelineHandlers({
          logger: silentLogger,
          reporter: noopErrorReporter,
          store: f.store,
          clock: { now: () => now },
        });
        return fresh.GET(
          new Request(`http://localhost/api/rounds/${roundId}/timeline`),
          roundId!,
        );
      };
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
          body,
          response,
          timeline,
          ladderEntries: (ladder?.data.entries ?? []).filter(
            (e) => e.id === f.host.actorId,
          ).length,
          memberRating: member.find((m) => m.ladder === 'freestyle')?.rating,
          historyRows: profile?.history.length,
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
        expected: { stage: { kind: 'slate' }, result: null, captions: [] },
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
        given: 'a public profile before release',
        should: 'list no Round',
        actual: held.historyRows,
        expected: 0,
      });
      assert({
        given: 'notifications before release',
        should: 'hold nothing, as nothing stores an outcome notification',
        actual: getNotifications({}).rows,
        expected: [],
      });
      const round = await f.store.readLaunchedRound(
        roundId,
        f.host,
        () => true,
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
          }),
        code: 'NOT_FOUND',
      });

      await f.sql`update broadcasts set released_through_at=${new Date(
        completedAt.getTime() + SPECTATOR_MARGIN_MS,
      )} where round_id=${roundId}`;
      const out = await reads();
      await f.sql`update rounds set visibility='unlisted' where id=${roundId}`;
      const unlisted = await timelineResponse();
      await f.sql`update rounds set visibility='private' where id=${roundId}`;
      const hidden = await timelineResponse();
      await f.sql`update rounds set visibility='public' where id=${roundId}`;
      assert({
        given: 'an unlisted Round by its link, then a private Round',
        should: 'serve the first unindexed and admit no audience to the second',
        actual: [
          unlisted.status,
          unlisted.headers.get('X-Robots-Tag'),
          hidden.status,
        ],
        expected: [200, 'noindex', 404],
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
          cache: out.response.headers.get('Cache-Control'),
          cookie: out.response.headers.get('Set-Cookie'),
        },
        expected: {
          stage: { kind: 'ended' },
          winner: 'affirmative',
          reasons: [REASON],
          ratings: 2,
          cache: PUBLIC_SNAPSHOT_CACHE,
          cookie: null,
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
        given: 'ratings, standings and profiles after release',
        should: 'show the rated Round',
        actual: [out.ladderEntries, out.memberRating !== null, out.historyRows],
        expected: [1, true, 1],
      });
    } finally {
      if (roundId) {
        await f.sql`delete from broadcasts where round_id=${roundId}`;
        await f.sql`delete from rating_changes where round_id=${roundId}`;
      }
      await f.sql`delete from ratings where actor_id in (${f.host.actorId},${f.guest.actorId})`;
      await f.sql`delete from agreement_signatures where season_id=${seasonId}`;
      await f.sql`delete from seasons where id=${seasonId}`;
    }
  }, cachedAiJudgingRuntime);
});
