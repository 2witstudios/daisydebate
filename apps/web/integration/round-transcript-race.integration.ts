import { requireTestServices } from '@daisy/config';
import { withWebFinalizer } from './round-maintenance.test-support';
import { finishedOrBlockedBehind } from '@daisy/db/testing';
import { isAppError } from '@daisy/errors';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roundTickProjection } from '../src/features/round-finalization/operations';
import {
  startRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';
setupRitewayBun();
requireTestServices(process.env);

type Fixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
type Capture = ReturnType<Fixture['store']['createMediaCaptureOperations']>;
type CapturedStream = {
  readonly stream: Omit<
    Parameters<Capture['sealCapturedStream']>[0],
    'expectedChunkCount'
  >;
  readonly trackId: string;
  readonly start: number;
};
const buildProjection = roundTickProjection(createId);

const isConflict = (result: PromiseSettledResult<unknown> | undefined) =>
  result?.status === 'rejected' &&
  isAppError(result.reason) &&
  result.reason.code === 'CONFLICT';

/** A played Round whose two historical speeches each hold one captured clip. */
async function capturedRound(f: Fixture) {
  const { roundId } = await startRuntimeRound(f, await f.assemble());
  const initial = (await f.store.getRound(roundId))!;
  const elapsed = initial.rules.segments.reduce(
    (sum, s) => sum + s.durationMs + initial.rules.countdownMs,
    1000,
  );
  // Storage component: the real engine creates every historical row before capture begins.
  await f.sql`update rounds set started_at=clock_timestamp()-${elapsed}*interval '1 millisecond' where id=${roundId}`;
  await f.store.executeRoundTick({ roundId, buildProjection });
  const grants =
    await f.sql`select segment_id,round_participant_id,started_at,ended_at from round_speaking_intervals where round_id=${roundId} order by started_at,segment_id,round_participant_id`;
  const sessionId = createId(),
    workerId = createId();
  await f.sql`insert into media_sessions(id,round_id,room_name) values(${sessionId},${roundId},${createId()})`;
  const capture = f.store.createMediaCaptureOperations({
    nextId: createId,
    buildProjection,
  });
  const identity = { roundId, sessionId, workerId };
  const { epoch } = await capture.claimMediaWorkerLease({
    ...identity,
    leaseMs: 30000,
  });
  const streams: CapturedStream[] = [];
  for (const [index, grant] of grants.entries()) {
    const stream = {
        ...identity,
        epoch,
        segmentId: grant.segment_id as string,
        roundParticipantId: grant.round_participant_id as string,
      },
      trackId = createId();
    const start = new Date(grant.started_at).getTime();
    await capture.appendCapturedTranscript({
      ...stream,
      trackId,
      startOffsetMs: 100,
      durationMs: 100,
      text: `Captured speech ${index}`,
      before: new Date(start + 99).toISOString(),
      after: new Date(start + 201).toISOString(),
    });
    await capture.observeCapturedStream({
      ...stream,
      trackId,
      observedFrom: new Date(grant.started_at).toISOString(),
      observedUntil: new Date(grant.ended_at).toISOString(),
    });
    streams.push({ stream, trackId, start });
  }
  if (streams.length !== 2)
    throw new Error('Fixture requires two actual historical speeches');
  await capture.sealCapturedStream({
    ...streams[0]!.stream,
    expectedChunkCount: 1,
  });
  return { roundId, capture, last: streams[1]! };
}

const appendAt = (
  capture: Capture,
  last: CapturedStream,
  offsetMs: number,
  text: string,
) =>
  capture.appendCapturedTranscript({
    ...last.stream,
    trackId: last.trackId,
    startOffsetMs: offsetMs,
    durationMs: 100,
    text,
    before: new Date(last.start + offsetMs - 1).toISOString(),
    after: new Date(last.start + offsetMs + 101).toISOString(),
  });

/** Queues append, seal and freeze behind a held Round lock, then releases it. */
async function raceBehindRoundLock(
  f: Fixture,
  { roundId, capture, last }: Awaited<ReturnType<typeof capturedRound>>,
  finalizeRound: (roundId: string) => Promise<unknown>,
) {
  const holder = await f.sql.reserve();
  let races: Promise<unknown>[] = [];
  try {
    await holder`begin`;
    const [backend] = await holder`select pg_backend_pid() as pid`;
    await holder`select id from rounds where id=${roundId} for no key update`;
    const finalize = finalizeRound(roundId);
    races = [
      appendAt(capture, last, 300, 'Concurrent final clip'),
      capture.sealCapturedStream({ ...last.stream, expectedChunkCount: 1 }),
      finalize,
    ];
    const settled = Promise.allSettled(races);
    const blocked = await finishedOrBlockedBehind(
      finalize,
      f.sql,
      backend.pid,
      { now: performance.now, deadlineMs: 700 },
    );
    await holder`commit`;
    const [appended, sealed, finalized] = await settled;
    if (finalized!.status === 'rejected') throw finalized!.reason;
    // Exactly one of the append and the one-chunk seal wins the stream: a
    // sealed stream refuses the append, and a stored second chunk refuses
    // the seal, which leaves the stream open for finalization.
    const loser = appended!.status === 'fulfilled' ? sealed : appended;
    if (!isConflict(loser))
      throw loser!.status === 'rejected'
        ? loser!.reason
        : new Error('Both the append and the seal were accepted');
    return { blocked, accepted: appended!.status === 'fulfilled' };
  } finally {
    await holder`rollback`;
    holder.release();
    await Promise.allSettled(races);
  }
}

test('actual append seal and finalizer contention freezes one truthful committed frontier', async () =>
  withRoomRuntime(async (f) => {
    const round = await capturedRound(f);
    const { roundId } = round;
    // The lease is taken before the race, so the finalizer queues for the lock in order.
    const { blocked, accepted, frozen } = await withWebFinalizer(
      f,
      async (finalize) => {
        const raced = await raceBehindRoundLock(f, round, finalize);
        // The worker seals with the count of its own accepted appends.
        if (raced.accepted)
          await round.capture.sealCapturedStream({
            ...round.last.stream,
            expectedChunkCount: 2,
          });
        return { ...raced, frozen: await finalize(roundId) };
      },
    );
    const read = await f.store.readFrozenRoundTranscript(roundId);
    const [revision] =
      await f.sql`select revision from round_transcripts where round_id=${roundId}`;
    const ordered =
      await f.sql`select s.sequence as "segmentSequence",u.sequence,u.text from utterances u join round_segments s on s.id=u.segment_id and s.round_id=u.round_id where u.round_id=${roundId} order by s.sequence,u.sequence,u.id`;
    const before = JSON.stringify(read);
    const [late] = await Promise.allSettled([
      appendAt(round.capture, round.last, 500, 'Too late'),
    ]);
    const lines = accepted ? 3 : 2;
    assert({
      given:
        'actual bounded append/seal/freeze transactions queued behind the same canonical Round lock',
      should:
        'serialize accepted text into one sorted immutable revision once every stream seals at its true count',
      actual: {
        blocked,
        status: frozen.status,
        completeness: read?.completeness,
        frontier: read?.frontier,
        revision: revision.revision,
        lines: read?.utterances.length,
        ordered: read?.utterances.map(
          ({ segmentSequence, sequence, text }) => ({
            segmentSequence,
            sequence,
            text,
          }),
        ),
        lateRefused:
          isConflict(late) &&
          // The freeze fence refuses before the sealed-stream check could.
          (late as PromiseRejectedResult).reason.message ===
            'Capture admission is closed',
        unchanged:
          JSON.stringify(await f.store.readFrozenRoundTranscript(roundId)) ===
          before,
      },
      expected: {
        blocked: 'blocked',
        status: 'frozen',
        completeness: 'complete',
        frontier: lines + 4,
        revision: lines + 4,
        lines,
        ordered: [...ordered],
        lateRefused: true,
        unchanged: true,
      },
    });
  }));
