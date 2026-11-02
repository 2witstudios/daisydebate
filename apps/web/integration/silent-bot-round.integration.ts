import { requireTestServices } from '@daisy/config';
import {
  oneOnOneDefinition,
  oneOnOneSettings,
} from '@daisy/db/reference-formats';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roundTickProjection } from '../src/features/round-finalization/operations';
import { botControlOptions } from './bot-control.test-support';
import { everyoneReady } from './round-judging.test-support';
import { finalizeAsWeb } from './round-maintenance.test-support';
import { openRoundCapture } from './round-media.test-support';
import {
  startRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';

setupRitewayBun();
requireTestServices(process.env);

type Fixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];

/** Human against a bot with an AI judge, every segment played, inside the admission cutoff. */
async function playedBotRound(f: Fixture) {
  const judge = await f.aiJudge();
  const bot = await f.bot();
  let room = (
    await f.create({
      selection: {
        kind: 'custom',
        definition: {
          ...oneOnOneDefinition,
          seats: { ...oneOnOneDefinition.seats, judge: 1 },
        },
        config: oneOnOneSettings,
        competitionType: 'casual',
      },
    })
  ).view;
  room = await f.seatBotOpponent(room, bot.actorId);
  room = (
    await f.command(f.host, room, {
      type: 'assign-seat',
      role: 'judge',
      slot: 0,
      actorId: judge.actorId,
    })
  ).view;
  room = await everyoneReady(f, room, [f.host]);
  const { roundId } = await startRuntimeRound(f, room);
  const round = (await f.store.getRound(roundId))!;
  const elapsed = round.rules.segments.reduce(
    (n, s) => n + s.durationMs + round.rules.countdownMs,
    30_000,
  );
  await f.sql`update rounds set started_at=clock_timestamp()-${elapsed}*interval '1 millisecond' where id=${roundId}`;
  await f.store.executeRoundTick({
    roundId,
    buildProjection: roundTickProjection(createId),
  });
  const debaters = await f.sql<
    { id: string; kind: string; role: string }[]
  >`select p.id,a.kind,p.role from round_participants p join actors a on a.id=p.actor_id
    where p.round_id=${roundId} and p.role<>'judge'`;
  const seatOf = (kind: string) => debaters.find((p) => p.kind === kind)!;
  const human = seatOf('human');
  const bots = seatOf('bot');
  const segments = await f.sql<
    { id: string; sequence: number }[]
  >`select id,sequence from round_segments where round_id=${roundId} order by sequence`;
  const crossEx = (side: string) =>
    segments.find((segment) => {
      const rule = round.rules.segments[segment.sequence]!;
      return rule.type === 'cross_ex' && rule.side === side;
    })!.id;
  return {
    roundId,
    human,
    bot: bots,
    segments,
    /** The cross-examination the human opens: the bot only answers. */
    answering: crossEx(human.role),
    /** The cross-examination the bot is scheduled to open. */
    asking: crossEx(bots.role),
  };
}

/** Every stream except `leaving` as a full capture leaves it: the bot's speech credited. */
async function captureAllExcept(
  f: Fixture,
  played: Awaited<ReturnType<typeof playedBotRound>>,
  leaving: string,
) {
  await f.sql`insert into round_bot_publication_windows(id,round_id,segment_id,round_participant_id,credited_from,credited_until)
    select md5(i.segment_id),i.round_id,i.segment_id,i.round_participant_id,i.started_at,i.started_at+interval '1 second'
    from round_speaking_intervals i
    where i.round_id=${played.roundId} and i.round_participant_id=${played.bot.id} and i.segment_id<>${leaving}
      and i.segment_id<>${played.answering}`;
  await f.sql`insert into transcript_segments(round_id,segment_id,round_participant_id,state,chunk_count,sealed_chunk_count,sealed_at)
    select distinct i.round_id,i.segment_id,i.round_participant_id,'complete',0,0,clock_timestamp()
    from round_speaking_intervals i
    where i.round_id=${played.roundId} and (i.ended_at is null or i.ended_at>i.started_at)
      and not (i.segment_id=${leaving} and i.round_participant_id=${played.bot.id})
      and not (i.segment_id=${played.answering} and i.round_participant_id=${played.bot.id})`;
}

/** The capture worker's real zero-chunk seal for each seat it tracked and never heard. */
async function silentSeals(f: Fixture, roundId: string) {
  const { sessionId, workerId, capture } = await openRoundCapture(
    f,
    roundId,
    roundTickProjection(createId),
  );
  await f.sql`insert into media_worker_leases(session_id,worker_id,epoch,expires_at)
    values(${sessionId},${workerId},1,clock_timestamp()+interval '1 minute')`;
  return (segmentId: string, roundParticipantId: string) =>
    capture.sealCapturedStream({
      roundId,
      sessionId,
      workerId,
      epoch: 1,
      segmentId,
      roundParticipantId,
      expectedChunkCount: 0,
      framesLost: false,
    });
}

const judgingJobs = async (f: Fixture, roundId: string) =>
  (
    await f.sql`select status from round_judging_jobs where round_id=${roundId}`
  ).map((job: { status: string }) => job.status);

test('a bot that never answered in cross-examination seals complete and the AI judge rules (ISSUE-965)', async () => {
  await withRoomRuntime(async (f) => {
    const played = await playedBotRound(f);
    const sealSilent = await silentSeals(f, played.roundId);
    await captureAllExcept(f, played, played.answering);
    const seal = await sealSilent(played.answering, played.bot.id);
    const frozen = await finalizeAsWeb(f, played.roundId);
    assert({
      given:
        'a live capture worker sealing a bot respondent it never heard, with every other stream complete',
      should: 'seal complete, freeze complete and queue the AI judge',
      actual: {
        seal: seal.state,
        freeze: frozen.status === 'frozen' && frozen.freeze.completeness,
        jobs: await judgingJobs(f, played.roundId),
      },
      expected: { seal: 'complete', freeze: 'complete', jobs: ['queued'] },
    });
  }, botControlOptions);
});

test('a bot that never spoke its scheduled turn still freezes incomplete (ISSUE-965)', async () => {
  await withRoomRuntime(async (f) => {
    const played = await playedBotRound(f);
    const sealSilent = await silentSeals(f, played.roundId);
    await captureAllExcept(f, played, played.asking);
    await sealSilent(played.answering, played.bot.id);
    const seal = await sealSilent(played.asking, played.bot.id);
    const frozen = await finalizeAsWeb(f, played.roundId);
    assert({
      given: 'a bot silent in the cross-examination it was scheduled to open',
      should: 'seal partial, freeze incomplete and queue no AI judge',
      actual: {
        seal: seal.state,
        freeze: frozen.status === 'frozen' && frozen.freeze.completeness,
        jobs: await judgingJobs(f, played.roundId),
      },
      expected: { seal: 'partial', freeze: 'incomplete', jobs: [] },
    });
  }, botControlOptions);
});

test('a silent human respondent still seals partial and freezes incomplete (ISSUE-965)', async () => {
  await withRoomRuntime(async (f) => {
    const played = await playedBotRound(f);
    const sealSilent = await silentSeals(f, played.roundId);
    await captureAllExcept(f, played, played.answering);
    await sealSilent(played.answering, played.bot.id);
    await f.sql`delete from transcript_segments where round_id=${played.roundId}
      and segment_id=${played.asking} and round_participant_id=${played.human.id}`;
    const seal = await sealSilent(played.asking, played.human.id);
    const frozen = await finalizeAsWeb(f, played.roundId);
    assert({
      given: 'a human grant in cross-examination with no captured evidence',
      should: 'seal partial and freeze incomplete',
      actual: {
        seal: seal.state,
        freeze: frozen.status === 'frozen' && frozen.freeze.completeness,
        jobs: await judgingJobs(f, played.roundId),
      },
      expected: { seal: 'partial', freeze: 'incomplete', jobs: [] },
    });
  }, botControlOptions);
});

test('a turn the rules cannot name stays owed (ISSUE-965)', async () => {
  await withRoomRuntime(async (f) => {
    const played = await playedBotRound(f);
    const sealSilent = await silentSeals(f, played.roundId);
    const [segment] = await f.sql<
      { sequence: number }[]
    >`select sequence from round_segments where id=${played.answering}`;
    await f.sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`update rounds set rules_snapshot=rules_snapshot #- ${`{segments,${segment!.sequence},side}`}::text[] where id=${played.roundId}`;
    });
    const seal = await sealSilent(played.answering, played.bot.id);
    assert({
      given: 'a bot grant in a segment whose rule names no scheduled side',
      should: 'treat it as owed and seal partial',
      actual: seal.state,
      expected: 'partial',
    });
  }, botControlOptions);
});
