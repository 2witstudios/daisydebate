import {
  canReadRound,
  canReadTranscript,
} from '../src/features/round-runtime/reads';
import { createId } from '@paralleldrive/cuid2';
import { roundTickProjection } from '../src/features/round-finalization/operations';
import {
  oneOnOneDefinition,
  oneOnOneRoomConfig,
} from '@daisy/db/reference-formats';
import { ballotCategories, type Ballot } from '@daisy/protocol';
import { finalizeAsWeb } from './round-maintenance.test-support';
import {
  startRuntimeRound,
  type withRoomRuntime,
} from './round-runtime.test-support';
type RoomFixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
type ReadyRoom = Awaited<ReturnType<RoomFixture['consent']>>['view'];
/** Each caller in turn readies the Room from a fresh read of it. */
export async function everyoneReady(
  f: RoomFixture,
  room: ReadyRoom,
  callers: readonly Parameters<RoomFixture['consent']>[0][],
) {
  for (const caller of callers)
    room = (
      await f.consent(caller, await f.operations.view(caller, room.id), 'ready')
    ).view;
  return room;
}
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
/** A ready one-on-one casual Room with open judge seats. */
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
      config: oneOnOneRoomConfig,
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
  room = await everyoneReady(f, room, [f.host, f.guest, ...judges]);
  return { room, judges };
}
/** Ends every segment past the admission window; when captured, every debater stream sealed complete. */
export async function playOut(
  f: Parameters<Parameters<typeof withRoomRuntime>[0]>[0],
  roundId: string,
  captured: boolean,
) {
  const round = (await f.store.getRound(roundId))!;
  const elapsed = round.rules.segments.reduce(
    (n, s) => n + s.durationMs + round.rules.countdownMs,
    125000,
  );
  await f.sql`update rounds set started_at=clock_timestamp()-${elapsed}*interval '1 millisecond' where id=${roundId}`;
  if (!captured) return;
  await f.store.executeRoundTick({
    roundId,
    buildProjection: roundTickProjection(createId),
  });
  await f.sql`insert into transcript_segments(round_id,segment_id,round_participant_id,state,chunk_count,sealed_chunk_count,sealed_at)
    select distinct i.round_id,i.segment_id,i.round_participant_id,'complete',0,0,clock_timestamp()
    from round_speaking_intervals i join round_participants p on p.id=i.round_participant_id and p.round_id=i.round_id
    where i.round_id=${roundId} and p.role<>'judge' and (i.ended_at is null or i.ended_at>i.started_at)`;
}
/** The judged Room with a stored bot judge assigned and both debaters ready again. */
async function readyBotJudgedRoom(
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
  room = await everyoneReady(f, room, [f.host, f.guest]);
  return { room, judge };
}
/**
 * A bot-judged Round played out and frozen through the real finalizer.
 * `captured` marks every debater speech stream complete before the freeze,
 * as a full capture would; otherwise silence with no media freezes incomplete.
 */
export async function frozenBotJudgeRound(
  f: Parameters<Parameters<typeof withRoomRuntime>[0]>[0],
  captured: boolean,
) {
  const { room } = await readyBotJudgedRoom(f);
  const { roundId } = await startRuntimeRound(f, room);
  await playOut(f, roundId, captured);
  const finalized = await finalizeAsWeb(f, roundId);
  if (
    finalized.status !== 'frozen' ||
    finalized.freeze.completeness !== (captured ? 'complete' : 'incomplete')
  )
    throw Error('Expected the actual frozen input');
  return { roundId };
}
/** A fully captured bot-judged Round with its AI judging intent queued. */
export async function freezeBotJudge(
  f: Parameters<Parameters<typeof withRoomRuntime>[0]>[0],
) {
  const { roundId } = await frozenBotJudgeRound(f, true);
  const target = (await f.store.scanRoundJudgingJobs(64)).find(
    (job) => job.roundId === roundId,
  );
  if (!target) throw Error('Expected actual assigned judging intent');
  return { roundId, target };
}

/** The production private transcript policy, with coaching always enabled for these fixtures. */
export const readBallotAs = (
  f: RoomFixture,
  caller: { readonly userId: string; readonly actorId: string },
  roundId: string,
) =>
  f.store.readRoundBallot({
    caller,
    roundId,
    authorize: (r, a) => canReadRound(caller, r, a),
    authorizeTranscript: (r, a) => canReadTranscript(caller, r, a),
    authorizeCoaching: () => true,
  });
