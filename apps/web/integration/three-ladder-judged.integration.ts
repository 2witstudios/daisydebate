import { randomBytes } from 'node:crypto';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { withSeasons } from '@daisy/db/seasons';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ratingLadders } from '@daisy/protocol';
import {
  withRoomRuntime,
  startRuntimeRound,
} from './round-runtime.test-support';
import { fixtureBallot, playOut } from './round-judging.test-support';
import { readyRatedRoom } from './rated-room.test-support';
import { finalizeAsWeb } from './round-maintenance.test-support';
import { seedSettledAttendanceLedger } from './round-attendance-fixture.test-support';
import { createRoundBallotOperations } from '../src/features/round-ballots/operations';
import { createRoundJudgingOperations } from '../src/features/round-judging/operations';
import { createRatingSweep } from '../src/features/ratings/sweep';
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
              const room = await readyRatedRoom(f, ladder, judgeKind);
              ({ roundId } = await startRuntimeRound(f, room));
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
                const round = (await f.store.getRound(roundId))!;
                const seat = round.participants.find(
                  (p) => p.role === 'judge',
                )!;
                await createRoundBallotOperations({
                  store: f.store,
                  nextBallotId: createId,
                  nextSegmentId: createId,
                }).submit(
                  { kind: 'human', actorId: f.outsider.actorId },
                  roundId,
                  {
                    version: 1,
                    commandId: createId(),
                    expectedVersion: round.version,
                    judgeParticipantId: seat.id,
                    freezeRevision: frozen.freeze.revision,
                    ballot,
                  },
                );
              } else {
                const target = (await f.store.scanRoundJudgingJobs(64)).find(
                  (j) => j.roundId === roundId,
                )!;
                const claim = await f.store.claimRoundJudgingJob(target);
                await f.store.beginRoundJudgingModelCall(
                  claim.scope,
                  claim.token,
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
              // Membership survives a later ballot-status change; the Round's
              // finalized outcome, not a re-aggregation, remains authoritative.
              await f.sql`update ballots set status='voided',voided_at=clock_timestamp(),voided_by_actor_id=${f.host.actorId} where round_id=${roundId}`;
              const candidates = await f.store.readUnratedRatingRounds({
                limit: 64,
              });
              const sweep = () =>
                createRatingSweep({
                  database: f.store,
                  ids: { next: createId },
                  onFailure: (_id, error) => {
                    throw error;
                  },
                })({ limit: 64 });
              await Promise.all([sweep(), sweep()]);
              await sweep();
              const ledger =
                await f.sql`select actor_id,ladder,season_id,rating_before,rating_after from rating_changes where round_id=${roundId}`;
              const projection =
                await f.sql`select version from ratings where actor_id in (${f.host.actorId},${f.guest.actorId})`;
              const now = new Date().toISOString();
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
                  pending: display?.pending,
                  deltas: display?.rows.every((r) => r.delta !== null),
                  resolution: roundView.topic === room.topic,
                },
                expected: {
                  discovered: true,
                  rows: 2,
                  pools: [ladder],
                  seasons: [season.id],
                  versions: [1, 1],
                  entries: 2,
                  pending: false,
                  deltas: true,
                  resolution: true,
                },
              });
            } finally {
              if (roundId)
                await f.sql`delete from rating_changes where round_id=${roundId}`;
              await f.sql`delete from ratings where actor_id in (${f.host.actorId},${f.guest.actorId})`;
              await f.sql`delete from seasons where id=${seasonId}`;
            }
          },
          {
            ...botAdmissionForTests,
            judging: {
              leaseMs: 60000,
              model: 'fixture-model',
              nextToken: () => randomBytes(32).toString('base64url'),
            },
          },
        );
      });
