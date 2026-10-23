import {
  oneOnOneDefinition,
  practiceRoomConfig,
} from '@daisy/db/reference-formats';
import { ballotCategories, type Ballot } from '@daisy/protocol';
import { finalizeAsWeb } from './round-maintenance.test-support';
import {
  startRuntimeRound,
  type withRoomRuntime,
} from './round-runtime.test-support';
/** Controlled valid rubric response; never provider evidence. */
export const fixtureBallot = (
  reason: string,
  winner: Ballot['winner'] = 'affirmative',
): Ballot => ({
  rubricVersion: 'speaker-10@1',
  winner,
  reason,
  feedback: {},
  scores: Object.fromEntries(
    ['affirmative', 'negative'].map((side) => [
      side,
      Object.fromEntries(ballotCategories.map((key) => [key, 3])),
    ]),
  ) as Ballot['scores'],
});
/** A ready one-on-one practice Room with open judge seats. */
export const assembleJudgedRoom = (
  f: Parameters<Parameters<typeof withRoomRuntime>[0]>[0],
  judges = 1,
) =>
  f.assemble({
    selection: {
      kind: 'custom',
      definition: {
        ...oneOnOneDefinition,
        seats: { ...oneOnOneDefinition.seats, judge: judges },
      },
      config: practiceRoomConfig,
      length: 'full',
      competitionType: 'casual',
    },
  });
/** That Room with two human judges seated and every member ready. */
export async function readyTwoHumanJudgeRoom(
  f: Parameters<Parameters<typeof withRoomRuntime>[0]>[0],
) {
  const judges = [f.outsider, await f.member()];
  let room = await assembleJudgedRoom(f, judges.length);
  for (const [slot, judge] of judges.entries())
    room = (
      await f.command(judge, room, { type: 'claim-seat', role: 'judge', slot })
    ).view;
  for (const caller of [f.host, f.guest, ...judges])
    room = (
      await f.consent(caller, await f.operations.view(caller, room.id), 'ready')
    ).view;
  return { room, judges };
}
/** Real Room/engine/finalizer storage fixture. Silence stays incomplete; attendance is never fabricated. */
export async function freezeBotJudge(
  f: Parameters<Parameters<typeof withRoomRuntime>[0]>[0],
) {
  const judge = await f.bot();
  let room = await assembleJudgedRoom(f);
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
  const finalized = await finalizeAsWeb(f, roundId);
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
