import { judgingJobRules, ratingAwaited } from '@daisy/debate-engine';
import { randomBytes } from 'node:crypto';
import { roundTickProjection } from '../src/features/round-finalization/operations';
import { createId } from '@paralleldrive/cuid2';
import {
  agreementWords,
  contentWaiverDocument,
  CONTENT_WAIVER_VERSION,
  roundCaptureNotice,
} from '../src/features/legal/agreements';
import { createRatingSweep } from '../src/features/ratings/sweep';
import { createRoundJudgingOperations } from '../src/features/round-judging/operations';
import type { Ballot, RatingLadder } from '@daisy/protocol';
import type { withRoomRuntime } from './room-runtime.test-support';
import { launchRuntimeRound } from './round-runtime.test-support';
import { everyoneReady, playOut } from './round-judging.test-support';
import { finalizeAsWeb } from './round-maintenance.test-support';
import { seedSettledAttendanceLedger } from './round-attendance-fixture.test-support';
import { strikeToReveal } from './room-draw.test-support';
import { botAdmissionForTests } from './bot-admission.test-support';
type Fixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
/** Canonical setup proof; only the test-owned prep anchor advances, never real time. */
export async function readyRankedRoom(
  f: Fixture,
  ladder: RatingLadder,
  judgeKind: 'human' | 'ai',
) {
  const [preset] =
    await f.sql`select format_version,version from format_presets where format_id=${ladder} and superseded_at is null`;
  for (const member of [f.host, f.guest, f.outsider])
    await f.store.signContentWaiver({
      id: createId(),
      userId: member.userId,
      version: CONTENT_WAIVER_VERSION,
      words: agreementWords(contentWaiverDocument),
    });
  let room = await f.assemble({
    noticeVersion: roundCaptureNotice('ranked')!.version,
    resolution:
      ladder === 'freestyle'
        ? { kind: 'strike' }
        : {
            kind: ladder,
            id:
              ladder === 'policy'
                ? 's3vycbr7v7fl6a2xzmgneize'
                : 'd3qrq2srlk8wpa3qhzefly0y',
          },
    selection: {
      kind: 'ranked',
      formatId: ladder,
      formatVersion: preset!.format_version,
      presetVersion: preset!.version,
    },
  });
  if (judgeKind === 'human')
    room = (
      await f.command(f.outsider, room, {
        type: 'claim-seat',
        role: 'judge',
        slot: 0,
      })
    ).view;
  else
    room = (
      await f.command(f.host, room, {
        type: 'assign-seat',
        role: 'judge',
        slot: 0,
        actorId: (await f.aiJudge()).actorId,
      })
    ).view;
  room = await everyoneReady(
    f,
    room,
    judgeKind === 'human' ? [f.host, f.guest, f.outsider] : [f.host, f.guest],
  );
  return room;
}

/** Exercise duplicate delivery plus a fresh sweep over durable rating discovery. */
export async function recoverRankedResults(f: Fixture) {
  const sweep = createRatingSweep({
    database: f.store,
    ids: { next: createId },
    onFailure: (_id, error) => {
      throw error;
    },
  });
  // Every page: candidates other suites left unrated also fill a page.
  const sweepAll = async (afterId?: string): Promise<void> => {
    const page = await sweep({ limit: 64, ...(afterId ? { afterId } : {}) });
    if (!page.exhausted) await sweepAll(page.afterId);
  };
  await Promise.all([sweepAll(), sweepAll()]);
  await sweepAll();
}

/**
 * A Freestyle Round's opening, run to its first speech's countdown: both
 * debaters strike to the reveal, and its 20:00 prep is cut to a millisecond,
 * the one fact a test may move without waiting for the clock.
 */
export async function runRankedOpening(f: Fixture, roundId: string) {
  const [row] = await f.sql`select status from rounds where id=${roundId}`;
  if (row?.status !== 'opening') return;
  await strikeToReveal(f, roundId, { host: f.host, guest: f.guest });
  await f.sql`update rounds set pre_round_prep_ms=1 where id=${roundId}`;
  await f.store.executeRoundTick({
    roundId,
    runsOpening: true,
    buildProjection: roundTickProjection(createId),
  });
}

/** Runtime options for a Round whose AI judge serves a cached fixture ballot. */
export const cachedAiJudgingRuntime = {
  ...botAdmissionForTests,
  judging: {
    leaseMs: 60000,
    model: 'fixture-model',
    nextToken: () => randomBytes(32).toString('base64url'),
    contractVersion: 'fixture-contract',
    rules: judgingJobRules,
  },
};

/** A ranked Round played out, frozen complete by the real finalizer, attendance settled. */
export async function frozenRankedRound(
  f: Fixture,
  ladder: RatingLadder,
  judgeKind: 'human' | 'ai',
) {
  const room = await readyRankedRoom(f, ladder, judgeKind);
  const { roundId } = await launchRuntimeRound(f, room);
  await runRankedOpening(f, roundId);
  await playOut(f, roundId, true);
  const frozen = await finalizeAsWeb(f, roundId);
  if (frozen.status !== 'frozen' || frozen.freeze.completeness !== 'complete')
    throw Error('Expected complete shared freeze');
  await seedSettledAttendanceLedger(f, roundId);
  return { room, roundId, freezeRevision: frozen.freeze.revision };
}

/** The real AI judging claim, resolved from a saved response with no provider call. */
export async function judgeWithCachedAi(
  f: Fixture,
  roundId: string,
  ballot: Ballot,
) {
  const target = (await f.store.scanRoundJudgingJobs(64, 'generation')).find(
    (j) => j.roundId === roundId,
  )!;
  const claim = await f.store.claimRoundJudgingJob(target);
  await f.store.beginRoundJudgingModelCall(claim.scope, claim.token);
  await f.store.saveRoundJudgingResult(claim.scope, claim.token, ballot, {
    inputTokens: 1,
    outputTokens: 1,
  });
  const judging = createRoundJudgingOperations({
    store: f.store,
    nextId: createId,
    voice: () => {
      throw Error('Cached fixture never calls provider');
    },
    withProvider: async () => {
      throw Error('Cached fixture never acquires provider');
    },
  });
  await judging.executeClaim(claim, new AbortController().signal);
  return { claim, judging };
}

/** Whether durable rating discovery still owes this Round a rating. */
export const awaitsRating = async (
  f: Pick<Fixture, 'store'>,
  roundId: string,
) => {
  const facts = await f.store.readRatingFacts(roundId);
  return facts !== null && ratingAwaited(facts);
};
