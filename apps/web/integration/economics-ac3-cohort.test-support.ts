import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { canUseRoundAnalysis } from '../src/features/round-analysis/authorization';
import {
  withRoomRuntime,
  launchRuntimeRound,
} from './round-runtime.test-support';
import { everyoneReady, playOut } from './round-judging.test-support';
import { finalizeAsWeb } from './round-maintenance.test-support';
import { seedSettledAttendanceLedger } from './round-attendance-fixture.test-support';

type RuntimeFixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
/** Existing legal Round/attendance/transcript TEST fixtures; no usage, attempt, dispatch or paid rows inserted. */
export async function prepareAc3Round(f: RuntimeFixture, fresh: boolean) {
  const cast = fresh ? await f.freshCast() : { host: f.host, guest: f.guest };
  const room = await f.assemble(
    { selection: await assembleJudgedRoomSelection() },
    cast,
  );
  const judge = await f.aiJudge();
  const assigned = (
    await f.command(cast.host, room, {
      type: 'assign-seat',
      role: 'judge',
      slot: 0,
      actorId: judge.actorId,
    })
  ).view;
  const ready = await everyoneReady(f, assigned, [cast.host, cast.guest]);
  const { roundId } = await launchRuntimeRound(f, ready);
  await playOut(f, roundId, true);
  const round = (await f.store.getRound(roundId))!,
    segment = round.segments[0]!,
    seat = round.participants.find((p) => p.actorId === cast.host.actorId)!;
  await f.sql`insert into utterances(id,round_id,segment_id,round_participant_id,sequence,text) values(${createId()},${roundId},${segment.id},${seat.id},0,'Controlled admitted TEST speech for economics volume qualification')`;
  await f.sql`insert into round_transcripts(round_id,revision) values(${roundId},1) on conflict(round_id) do update set revision=1`;
  await finalizeAsWeb(f, roundId);
  await seedSettledAttendanceLedger(f, roundId);
  return { roundId, caller: cast.host, roundParticipantId: seat.id };
}

async function assembleJudgedRoomSelection() {
  const { oneOnOneDefinition, oneOnOneSettings } =
    await import('@daisy/db/reference-formats');
  return {
    kind: 'custom' as const,
    definition: {
      ...oneOnOneDefinition,
      seats: { ...oneOnOneDefinition.seats, judge: 1 },
    },
    config: oneOnOneSettings,
    competitionType: 'casual' as const,
  };
}

export const requestAc3Analysis = (
  f: RuntimeFixture,
  target: Awaited<ReturnType<typeof prepareAc3Round>>,
) =>
  f.store.requestRoundAnalysis({
    roundId: target.roundId,
    caller: target.caller,
    authorize: (access) =>
      canUseRoundAnalysis(access, 'round.analysis.request'),
  });
export const readAc3Analysis = (
  f: RuntimeFixture,
  target: Awaited<ReturnType<typeof prepareAc3Round>>,
) =>
  f.store.readRoundAnalysis({
    roundId: target.roundId,
    caller: target.caller,
    authorize: (access) => canUseRoundAnalysis(access, 'round.analysis.read'),
  });

/** A controlled tombstone fact must still close every human participant's private read. */
export async function refuseAc3AfterPeerErasure(
  f: RuntimeFixture,
  target: Awaited<ReturnType<typeof prepareAc3Round>>,
) {
  await f.sql`update users set deleted_at=clock_timestamp() where id=${f.guest.userId}`;
  await assertRejects({
    given:
      'a stored report on a bot-judged Round after another human participant is tombstoned',
    should: 'retain every human privacy fence and refuse the report',
    actual: () => readAc3Analysis(f, target),
    code: 'NOT_FOUND',
  });
}
