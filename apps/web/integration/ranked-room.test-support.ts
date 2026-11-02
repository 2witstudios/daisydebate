import { randomBytes } from 'node:crypto';
import { createId } from '@paralleldrive/cuid2';
import { createRatingSweep } from '../src/features/ratings/sweep';
import { createRoundJudgingOperations } from '../src/features/round-judging/operations';
import type { Ballot, RatingLadder } from '@daisy/protocol';
import type { withRoomRuntime } from './room-runtime.test-support';
import { startRuntimeRound } from './round-runtime.test-support';
import { everyoneReady, playOut } from './round-judging.test-support';
import { finalizeAsWeb } from './round-maintenance.test-support';
import { seedSettledAttendanceLedger } from './round-attendance-fixture.test-support';
import { strikeStanding } from './room-draw.test-support';
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
  let room = await f.assemble({
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
  if (ladder === 'freestyle') {
    room = (await f.command(f.host, room, { type: 'start-pre-round' })).view;
    for (
      let ordinal = 0;
      ordinal < (room.resolutionDraw?.drawSize ?? 1) - 1;
      ordinal++
    ) {
      const who = ordinal % 2 === 0 ? f.guest : f.host;
      room = (
        await strikeStanding(
          f,
          await f.operations.view(who, room.id),
          who,
          ordinal,
        )
      ).view;
    }
    await f.sql`update rooms set prep_started_at=clock_timestamp()-interval '21 minutes' where id=${room.id}`;
    room = await f.operations.view(f.host, room.id);
  }
  return room;
}

/** Exercise duplicate delivery plus a fresh sweep over durable rating discovery. */
export async function recoverRankedResults(f: Fixture) {
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
}

/** Runtime options for a Round whose AI judge serves a cached fixture ballot. */
export const cachedAiJudgingRuntime = {
  ...botAdmissionForTests,
  judging: {
    leaseMs: 60000,
    model: 'fixture-model',
    nextToken: () => randomBytes(32).toString('base64url'),
  },
};

/** A ranked Round played out, frozen complete by the real finalizer, attendance settled. */
export async function frozenRankedRound(
  f: Fixture,
  ladder: RatingLadder,
  judgeKind: 'human' | 'ai',
) {
  const room = await readyRankedRoom(f, ladder, judgeKind);
  const { roundId } = await startRuntimeRound(f, room);
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
  const target = (await f.store.scanRoundJudgingJobs(64)).find(
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
