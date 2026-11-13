import { canUseAiAllowance } from '@daisy/auth/authorization';
import { atFinalJudgingStage } from '@daisy/db/testing';
import {
  judgingJobRules,
  RANKED_DELAY_SECONDS,
  ratingAwaited,
  readRoundOpening,
  roundWaitingOn,
} from '@daisy/debate-engine';
import { randomBytes } from 'node:crypto';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { withSeasons } from '@daisy/db/seasons';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ratingLadders } from '@daisy/protocol';
import {
  withRoomRuntime,
  launchRuntimeRound,
} from './round-runtime.test-support';
import {
  fixtureBallot,
  playOut,
  submitHumanBallot,
} from './round-judging.test-support';
import {
  readyRankedRoom,
  recoverRankedResults,
  runRankedOpening,
} from './ranked-room.test-support';
import { finalizeAsWeb } from './round-maintenance.test-support';
import { seedSettledAttendanceLedger } from './round-attendance-fixture.test-support';
import { createRoundJudgingOperations } from '../src/features/round-judging/operations';
import { readLadder } from '../src/features/leaderboard/read-leaderboard';
import { readMemberStandings } from '../src/features/ratings/read-member';
import { readRoundRatings } from '../src/features/ratings/read-round';
import { botAdmissionForTests } from './bot-admission.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

for (const ladder of ratingLadders)
  for (const judgeKind of ['human', 'ai'] as const)
    for (const outcome of ['affirmative', 'negative'] as const)
      test(`${ladder}/${judgeKind}/${outcome}: shared setup, frozen membership and restart-safe rated displays`, async () => {
        await withRoomRuntime(
          async (f) => {
            const seasonId = createId();
            let roundId: string | undefined;
            try {
              const season = await withSeasons(databaseUrl, (s) =>
                s.activateBetaSeason({ id: seasonId }),
              );
              const room = await readyRankedRoom(f, ladder, judgeKind);
              ({ roundId } = await launchRuntimeRound(f, room));
              await runRankedOpening(f, roundId);
              await playOut(f, roundId, true);
              const frozen = await finalizeAsWeb(f, roundId);
              if (
                frozen.status !== 'frozen' ||
                frozen.freeze.completeness !== 'complete'
              )
                throw Error('Expected complete shared freeze');
              await seedSettledAttendanceLedger(f, roundId);
              const ballot = fixtureBallot(
                'Controlled shared ballot, not provider evidence.',
                outcome,
              );
              if (judgeKind === 'human') {
                await submitHumanBallot(
                  f,
                  roundId,
                  f.outsider.actorId,
                  frozen.freeze.revision,
                  ballot,
                );
              } else {
                const target = (
                  await f.store.scanRoundJudgingJobs(64, 'generation')
                ).find((j) => j.roundId === roundId)!;
                await atFinalJudgingStage(f.sql, target);
                const claim = await f.store.claimRoundJudgingJob(target);
                await f.store.beginRoundJudgingModelCall(
                  claim.scope,
                  claim.token,
                  'final',
                );
                await f.store.saveRoundJudgingResult(
                  claim.scope,
                  claim.token,
                  ballot,
                  { inputTokens: 1, outputTokens: 1 },
                );
                await createRoundJudgingOperations({
                  store: f.store,
                  nextId: createId,
                  voice: () => {
                    throw Error('Cached fixture never calls provider');
                  },
                  withProvider: async () => {
                    throw Error('Cached fixture never acquires provider');
                  },
                }).executeClaim(claim, new AbortController().signal);
              }
              const candidates = (
                await f.store.readRatingCandidates({ limit: 1000 })
              )
                .filter(({ facts }) => facts !== null && ratingAwaited(facts))
                .map(({ roundId: id }) => id);
              await recoverRankedResults(f);
              const ledger =
                await f.sql`select actor_id,ladder,season_id,rating_before,rating_after from rating_changes where round_id=${roundId}`;
              const projection =
                await f.sql`select version from ratings where actor_id in (${f.host.actorId},${f.guest.actorId})`;
              // The audience reads the ranked result once the delay has passed.
              const now = new Date(
                Date.now() + (RANKED_DELAY_SECONDS + 1) * 1000,
              ).toISOString();
              const leaderboard = await readLadder(f.store, {
                seasonId: season.id,
                ladder,
                now,
                username: null,
              });
              const roundView = await f.store.readLaunchedRound(
                roundId,
                f.host,
                () => true,
                readRoundOpening,
                roundWaitingOn,
              );
              const display = await readRoundRatings(f.store, {
                round: roundView,
                now,
                viewerActorId: f.host.actorId,
              });
              const member = await readMemberStandings(f.store, {
                username: `u-${f.host.userId}`,
                now,
              });
              const seatRoles = roundView.participants.map((p) => p.role);
              const hostPost = ledger.find(
                (r: { actor_id: string }) => r.actor_id === f.host.actorId,
              )!;
              const expectedRating = Math.round(Number(hostPost.rating_after));
              assert({
                given:
                  'one posted Glicko result read through every shared output',
                should:
                  'show the exact same host rating on profile, leaderboard and Round',
                actual: [
                  member.find((r) => r.ladder === ladder)?.rating,
                  Math.round(
                    leaderboard!.data.entries.find(
                      (e) => e.id === f.host.actorId,
                    )!.rating,
                  ),
                  display!.rows[0]?.rating,
                ],
                expected: [expectedRating, expectedRating, expectedRating],
              });
              assert({
                given: `${ladder} shared ${judgeKind} completion, later void and duplicate/restarted recovery`,
                should:
                  'retain original membership and post both sides once to the selected season/ladder with authoritative UI output',
                actual: {
                  discovered: candidates.includes(roundId),
                  rows: ledger.length,
                  pools: [
                    ...new Set(ledger.map((r: { ladder: string }) => r.ladder)),
                  ],
                  seasons: [
                    ...new Set(
                      ledger.map((r: { season_id: string }) => r.season_id),
                    ),
                  ],
                  versions: projection.map(
                    (r: { version: number }) => r.version,
                  ),
                  entries: leaderboard?.data.entries.length,
                  posting: display?.posting,
                  deltas: display?.rows.every((r) => r.delta !== null),
                  seatsInOrder:
                    seatRoles.join() === [...seatRoles].sort().join(),
                  resolution:
                    roundView.topic !== null &&
                    (room.topic === null || roundView.topic === room.topic),
                },
                expected: {
                  discovered: true,
                  rows: 2,
                  pools: [ladder],
                  seasons: [season.id],
                  versions: [1, 1],
                  entries: 2,
                  posting: 'rated',
                  deltas: true,
                  seatsInOrder: true,
                  resolution: true,
                },
              });
            } finally {
              if (roundId)
                await f.sql`delete from rating_changes where round_id=${roundId}`;
              await f.sql`delete from ratings where actor_id in (${f.host.actorId},${f.guest.actorId})`;
              await f.sql`delete from agreement_signatures where season_id=${seasonId}`;
              await f.sql`delete from seasons where id=${seasonId}`;
            }
          },
          {
            ...botAdmissionForTests,
            judging: {
              leaseMs: 60000,
              model: 'fixture-model',
              nextToken: () => randomBytes(32).toString('base64url'),
              contractVersion: 'fixture-contract',
              rules: judgingJobRules,
              accountEligible: canUseAiAllowance,
            },
          },
        );
      });
