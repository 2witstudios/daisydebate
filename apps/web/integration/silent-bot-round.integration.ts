import { requireTestServices } from '@daisy/config';
import {
  oneOnOneDefinition,
  oneOnOneSettings,
} from '@daisy/db/reference-formats';
import type { FormatSettings } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roundTickProjection } from '../src/features/round-finalization/operations';
import { botControlOptions } from './bot-control.test-support';
import { assignAiJudgeAndReady } from './round-judging.test-support';
import { finalizeAsWeb } from './round-maintenance.test-support';
import { openRoundCapture } from './round-media.test-support';
import {
  launchRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';

setupRitewayBun();
requireTestServices(process.env);

type Fixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];

/** Human against a bot with an AI judge, every segment played, inside the admission cutoff. */
async function playedBotRound(
  f: Fixture,
  interruptions: FormatSettings['interruptions'] = oneOnOneSettings.interruptions,
) {
  const bot = await f.bot();
  let room = (
    await f.create({
      selection: {
        kind: 'custom',
        definition: {
          ...oneOnOneDefinition,
          seats: { ...oneOnOneDefinition.seats, judge: 1 },
          configurable: {
            ...oneOnOneDefinition.configurable,
            interaction: {
              ...oneOnOneDefinition.configurable.interaction,
              interruptions: {
                modes: ['disabled', 'enabled', 'open'],
                minRemainingMs: { min: 0, max: 300_000 },
              },
            },
          },
        },
        config: { ...oneOnOneSettings, interruptions },
        competitionType: 'casual',
      },
    })
  ).view;
  room = await f.seatBotOpponent(room, bot.actorId);
  ({ room } = await assignAiJudgeAndReady(f, room, [f.host]));
  const { roundId } = await launchRuntimeRound(f, room);
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

/**
 * Every stream except the bot's in `leaving` as a played Round leaves it: each
 * human stream captured complete, and the bot's speech authored, its stream
 * complete by construction (ADR 0122). The bot answers nothing in `answering`.
 */
async function speakAllExcept(
  f: Fixture,
  played: Awaited<ReturnType<typeof playedBotRound>>,
  leaving: string,
) {
  await f.sql`insert into utterances(id,round_id,segment_id,round_participant_id,sequence,text,complete,bot_phrase_id,bot_duration_ms,created_at)
    select md5(i.segment_id||'line'),i.round_id,i.segment_id,i.round_participant_id,0,'An authored line.',true,md5(i.segment_id||'phrase'),1000,i.started_at
    from (select distinct on (segment_id) * from round_speaking_intervals
      where round_id=${played.roundId} and round_participant_id=${played.bot.id}
        and segment_id<>${leaving} and segment_id<>${played.answering}
      order by segment_id, started_at) i`;
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

/** What the real finalizer froze, and the jobs it queued. */
const freezeOf = async (f: Fixture, roundId: string) => {
  const frozen = await finalizeAsWeb(f, roundId);
  return {
    freeze:
      frozen.status === 'frozen' ? frozen.freeze.completeness : frozen.status,
    jobs: await judgingJobs(f, roundId),
  };
};

const judgingJobs = async (f: Fixture, roundId: string) =>
  (
    await f.sql`select status from round_judging_jobs where round_id=${roundId}`
  ).map((job: { status: string }) => job.status);

test('a bot that never answered in cross-examination owes nothing and the AI judge rules (ISSUE-965)', async () => {
  await withRoomRuntime(async (f) => {
    const played = await playedBotRound(f);
    await speakAllExcept(f, played, played.answering);
    assert({
      given:
        'a bot respondent that authored nothing, with every other stream complete',
      should: 'freeze complete and queue the AI judge',
      actual: await freezeOf(f, played.roundId),
      expected: { freeze: 'complete', jobs: ['queued'] },
    });
  }, botControlOptions);
});

test('a bot silent in its scheduled turn stays owed with admission open (ISSUE-965)', async () => {
  await withRoomRuntime(async (f) => {
    const played = await playedBotRound(f);
    await speakAllExcept(f, played, played.asking);
    assert({
      given: 'a bot that authored nothing in the cross-examination it opens',
      should:
        'keep admission open before cutoff and queue no AI judge: a silent bot is a failure',
      actual: await freezeOf(f, played.roundId),
      expected: { freeze: 'pending', jobs: [] },
    });
  }, botControlOptions);
});

test('capture never seals a bot seat: its words are authored (ADR 0122)', async () => {
  await withRoomRuntime(async (f) => {
    const played = await playedBotRound(f);
    const sealSilent = await silentSeals(f, played.roundId);
    assert({
      given: 'a live capture worker sealing a bot seat’s stream',
      should: 'refuse it as bot-authored',
      actual: await sealSilent(played.answering, played.bot.id).then(
        () => 'sealed',
        (error: { reason?: string }) => error.reason,
      ),
      expected: 'bot-authored',
    });
  }, botControlOptions);
});

test('a human respondent without captured evidence stays partial with admission open (ISSUE-965)', async () => {
  await withRoomRuntime(async (f) => {
    const played = await playedBotRound(f);
    const sealSilent = await silentSeals(f, played.roundId);
    await speakAllExcept(f, played, played.answering);
    await f.sql`delete from transcript_segments where round_id=${played.roundId}
      and segment_id=${played.asking} and round_participant_id=${played.human.id}`;
    const seal = await sealSilent(played.asking, played.human.id);
    assert({
      given: 'a human grant in cross-examination with no captured evidence',
      should: 'seal partial and preserve admission before cutoff',
      actual: { seal: seal.state, ...(await freezeOf(f, played.roundId)) },
      expected: { seal: 'partial', freeze: 'pending', jobs: [] },
    });
  }, botControlOptions);
});

test('a turn the rules cannot name stays owed (ISSUE-965)', async () => {
  await withRoomRuntime(async (f) => {
    const played = await playedBotRound(f);
    await speakAllExcept(f, played, played.answering);
    const [segment] = await f.sql<
      { sequence: number }[]
    >`select sequence from round_segments where id=${played.answering}`;
    await f.sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`update rounds set rules_snapshot=rules_snapshot #- ${`{segments,${segment!.sequence},side}`}::text[] where id=${played.roundId}`;
    });
    assert({
      given:
        'a silent bot grant in a segment whose rule names no scheduled side',
      should: 'treat it as owed: admission stays open',
      actual: (await freezeOf(f, played.roundId)).freeze,
      expected: 'pending',
    });
  }, botControlOptions);
});

test("a bot silent during open questioning in another seat's speech owes nothing (ISSUE-965)", async () => {
  await withRoomRuntime(async (f) => {
    const played = await playedBotRound(f, {
      mode: 'open',
      minRemainingMs: 0,
    });
    const round = (await f.store.getRound(played.roundId))!;
    const humanSpeech = played.segments.find((segment) => {
      const rule = round.rules.segments[segment.sequence]!;
      return rule.type === 'speech' && rule.side === played.human.role;
    })!.id;
    await speakAllExcept(f, played, humanSpeech);
    assert({
      given:
        'a bot granted the floor by open questioning that never spoke, every other stream complete',
      should: 'freeze complete, as nothing was owed',
      actual: (await freezeOf(f, played.roundId)).freeze,
      expected: 'complete',
    });
  }, botControlOptions);
});
