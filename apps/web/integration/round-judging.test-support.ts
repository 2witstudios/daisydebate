import {
  oneOnOneDefinition,
  practiceRoomConfig,
} from '@daisy/db/reference-formats';
import { createId } from '@paralleldrive/cuid2';
import { createRoundFinalizationOperations } from '../src/features/round-finalization/operations';
import {
  startRuntimeRound,
  type withRoomRuntime,
} from './round-runtime.test-support';
/** Real Room/engine/finalizer storage fixture. Silence stays incomplete; attendance is never fabricated. */
export async function freezeBotJudge(
  f: Parameters<Parameters<typeof withRoomRuntime>[0]>[0],
) {
  const judge = await f.bot();
  let room = await f.assemble({
    selection: {
      kind: 'custom',
      definition: {
        ...oneOnOneDefinition,
        seats: { ...oneOnOneDefinition.seats, judge: 1 },
      },
      config: practiceRoomConfig,
      length: 'full',
      competitionType: 'casual',
    },
  });
  room = (
    await f.command(f.host, room, {
      type: 'assign-seat',
      role: 'judge',
      slot: 0,
      actorId: judge.actorId,
    })
  ).view;
  for (const caller of [f.host, f.guest])
    room = (
      await f.consent(caller, await f.operations.view(caller, room.id), 'ready')
    ).view;
  const { roundId } = await startRuntimeRound(f, room);
  const round = (await f.store.getRound(roundId))!;
  const elapsed = round.rules.segments.reduce(
    (n, s) => n + s.durationMs + round.rules.countdownMs,
    125000,
  );
  await f.sql`update rounds set started_at=clock_timestamp()-${elapsed}*interval '1 millisecond' where id=${roundId}`;
  const finalized = await createRoundFinalizationOperations({
    store: f.store,
    nextSegmentId: createId,
  }).finalize(roundId);
  if (
    finalized.status !== 'frozen' ||
    finalized.freeze.completeness !== 'incomplete'
  )
    throw Error('Expected actual incomplete frozen input');
  const target = (await f.store.scanRoundJudgingJobs(64)).find(
    (job) => job.roundId === roundId,
  );
  if (!target) throw Error('Expected actual assigned judging intent');
  return { roundId, target };
}
