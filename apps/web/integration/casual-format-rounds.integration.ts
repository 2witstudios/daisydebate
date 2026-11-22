import { requireTestServices } from '@daisy/config';
import {
  fourTeams,
  judgeSeat,
  sideSeat,
  type SeatRef,
} from '@daisy/protocol/seats';
import { type Ballot } from '@daisy/protocol/ballot-schema';
import { type RoomView } from '@daisy/protocol/room-contract';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roundTickProjection } from '../src/features/round-finalization/operations';
import { botAdmissionForTests } from './bot-admission.test-support';
import {
  passAttendanceCutoff,
  seedSettledAttendanceLedger,
} from './round-attendance-fixture.test-support';
import {
  everyoneReady,
  fixtureBallot,
  playOut,
  submitHumanBallot,
} from './round-judging.test-support';
import {
  finalizeAsWeb,
  finalizeByMaintenance,
  passBallotDeadline,
} from './round-maintenance.test-support';
import {
  launchRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';

setupRitewayBun();
requireTestServices(process.env);

/**
 * TAB-6.18's exit proofs: each of Daisy's casual templates runs as an
 * ordinary Room, from create to a completed Round, through the real Room,
 * Round, finalizer and ballot commands. Bots fill the competitor seats no
 * person takes, a side's or an unsided speaker's (TAB-6.18); a human judge
 * submits through the judge's own command.
 */
type Fixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
type Caller = Fixture['host'];

const catalog = (formatId: string) => ({
  kind: 'catalog' as const,
  formatId,
  formatVersion: 1,
  presetVersion: 1,
  competitionType: 'casual' as const,
});

/** A casual Room on a catalog template: its people claim seats, its bots are assigned, the people ready. */
async function seatedRoom(
  f: Fixture,
  formatId: string,
  people: readonly (readonly [Caller, SeatRef])[],
  botSeats: readonly SeatRef[],
) {
  let room: RoomView = (await f.create({ selection: catalog(formatId) })).view;
  for (const [who, seat] of people)
    room = (await f.command(who, room, { type: 'claim-seat', seat })).view;
  for (const seat of botSeats) {
    const bot = await f.bot();
    room = (
      await f.command(f.host, room, {
        type: 'assign-seat',
        actorId: bot.actorId,
        seat,
      })
    ).view;
  }
  return everyoneReady(
    f,
    room,
    people.map(([who]) => who),
  );
}

/** Each bot's speeches authored, as a bot speaks (ADR 0122). */
const authorBotSpeech = (f: Fixture, roundId: string) =>
  f.sql`insert into utterances(id,round_id,segment_id,round_participant_id,sequence,text,complete,bot_phrase_id,bot_duration_ms,created_at)
    select md5(i.segment_id||i.round_participant_id||'line'),i.round_id,i.segment_id,i.round_participant_id,
      (row_number() over (partition by i.segment_id order by i.round_participant_id))-1,
      'An authored line.',true,md5(i.segment_id||i.round_participant_id||'phrase'),1000,i.started_at
    from (select distinct on (s.segment_id, s.round_participant_id) s.*
      from round_speaking_intervals s
      join round_participants p on p.id=s.round_participant_id and p.round_id=s.round_id
      join actors a on a.id=p.actor_id
      where s.round_id=${roundId} and a.kind='bot'
      order by s.segment_id, s.round_participant_id, s.started_at) i`;

/** Every segment played and captured, the bots' speech authored, then the real finalizer's freeze. */
async function playedAndFrozen(f: Fixture, roundId: string) {
  await playOut(f, roundId, true);
  await authorBotSpeech(f, roundId);
  const finalized = await finalizeAsWeb(f, roundId);
  if (finalized.status !== 'frozen')
    throw Error(`Expected the real freeze, got ${finalized.status}`);
  return finalized.freeze.revision;
}

const judgingOf = async (f: Fixture, roundId: string) => {
  const [row] = await f.sql<
    { ballot: string | null; panel: string | null }[]
  >`select judging->'ballot'->>'key' || '@' || (judging->'ballot'->>'revision') as ballot,
      judging->'panel'->>'decision' as panel from rounds where id=${roundId}`;
  return row;
};

const resultOf = async (f: Fixture, roundId: string) => {
  const round = (await f.store.getRound(roundId))!;
  const [row] = await f.sql<
    { ballots: number }[]
  >`select count(*)::int as ballots from ballots where round_id=${roundId}`;
  return {
    status: round.status,
    outcome: round.outcome,
    ballots: row!.ballots,
  };
};

const rankingBallot = (
  rubricVersion: string,
  places: readonly string[],
): Ballot => ({
  rubricVersion,
  ranking: places.map((key) => [key]),
  reason: 'The order the speeches earned.',
  feedback: {},
});

test('a three-judge panel completes with the majority winner of a 2-1 split (TAB-6.18)', async () => {
  await withRoomRuntime(async (f) => {
    const judges = [f.outsider, f.guest, await f.member()];
    const room = await seatedRoom(
      f,
      'panel-debate',
      [
        [f.host, sideSeat('affirmative')],
        ...judges.map((judge, slot) => [judge, judgeSeat(slot)] as const),
      ],
      [sideSeat('negative')],
    );
    const { roundId } = await launchRuntimeRound(f, room);
    const freezeRevision = await playedAndFrozen(f, roundId);
    await seedSettledAttendanceLedger(f, roundId);
    const votes = ['affirmative', 'negative', 'affirmative'] as const;
    const pending: unknown[] = [];
    for (const [index, judge] of judges.entries()) {
      const receipt = await submitHumanBallot(
        f,
        roundId,
        judge.actorId,
        freezeRevision,
        fixtureBallot('The decisive clash went this way.', votes[index]),
      );
      if (index < judges.length - 1)
        pending.push([receipt.outcome, (await resultOf(f, roundId)).status]);
    }
    assert({
      given:
        'the three-judge template launched, played and frozen, then ballots for Affirmative, Negative and Affirmative',
      should:
        'freeze the winner ballot under a majority panel, wait for the third ballot, and complete for the Affirmative 2-1',
      actual: {
        judging: await judgingOf(f, roundId),
        pending,
        result: await resultOf(f, roundId),
      },
      expected: {
        judging: { ballot: 'speaker-10@2', panel: 'majority' },
        pending: [
          [null, 'active'],
          [null, 'active'],
        ],
        result: {
          status: 'completed',
          outcome: { kind: 'winner', side: 'affirmative' },
          ballots: 3,
        },
      },
    });
  }, botAdmissionForTests);
});

test('a three-judge panel with one ballot by the deadline ends below quorum with no outcome (TAB-6.9)', async () => {
  await withRoomRuntime(async (f) => {
    const judges = [f.outsider, f.guest, await f.member()];
    const room = await seatedRoom(
      f,
      'panel-debate',
      [
        [f.host, sideSeat('affirmative')],
        ...judges.map((judge, slot) => [judge, judgeSeat(slot)] as const),
      ],
      [sideSeat('negative')],
    );
    const { roundId } = await launchRuntimeRound(f, room);
    const freezeRevision = await playedAndFrozen(f, roundId);
    await seedSettledAttendanceLedger(f, roundId);
    await submitHumanBallot(
      f,
      roundId,
      judges[0]!.actorId,
      freezeRevision,
      fixtureBallot('The decisive clash went this way.', 'affirmative'),
    );
    await passBallotDeadline(f.sql, roundId);
    await finalizeByMaintenance(f, roundId);
    const [receipt] = await f.sql<
      { result: { ruling: string } }[]
    >`select result from round_commands where round_id=${roundId} and type='complete'`;
    const [quorum] = await f.sql<
      { quorum: number }[]
    >`select (judging->'panel'->>'quorum')::int as quorum from rounds where id=${roundId}`;
    assert({
      given:
        'the three-judge template launched, played and frozen, then one ballot before the ballot deadline passes',
      should:
        'freeze a quorum of two, and complete below quorum with no outcome',
      actual: {
        quorum: quorum?.quorum,
        ruling: receipt?.result.ruling,
        result: await resultOf(f, roundId),
      },
      expected: {
        quorum: 2,
        ruling: 'below-quorum',
        result: { status: 'completed', outcome: null, ballots: 1 },
      },
    });
  }, botAdmissionForTests);
});

test('a four-team Round completes with the four sides ranked by rank sum (TAB-6.18)', async () => {
  await withRoomRuntime(async (f) => {
    const [first, ...others] = fourTeams.map((team) => sideSeat(team.key));
    const room = await seatedRoom(
      f,
      'four-team',
      [
        [f.host, first!],
        [f.outsider, judgeSeat()],
      ],
      others,
    );
    const { roundId } = await launchRuntimeRound(f, room);
    const freezeRevision = await playedAndFrozen(f, roundId);
    await seedSettledAttendanceLedger(f, roundId);
    const order = [
      'closing_opposition',
      'opening_government',
      'closing_government',
      'opening_opposition',
    ];
    await submitHumanBallot(
      f,
      roundId,
      f.outsider.actorId,
      freezeRevision,
      rankingBallot('rank-sides@1', order),
    );
    assert({
      given:
        'the four-team template launched, played and frozen, then its judge ranking the four teams',
      should:
        'freeze the side ranking under rank sum and complete with the four sides in that order',
      actual: {
        judging: await judgingOf(f, roundId),
        result: await resultOf(f, roundId),
      },
      expected: {
        judging: { ballot: 'rank-sides@1', panel: 'rank_sum' },
        result: {
          status: 'completed',
          outcome: {
            kind: 'ranking',
            of: 'sides',
            places: order.map((side) => [side]),
          },
          ballots: 1,
        },
      },
    });
  }, botAdmissionForTests);
});

test('a six-speaker section completes with its six speaker seats ranked (TAB-6.18)', async () => {
  await withRoomRuntime(async (f) => {
    const speaker = (slot: number): SeatRef => ({ kind: 'speaker', slot });
    // One person speaks first; bot debaters hold the other five speaker seats.
    const room = await seatedRoom(
      f,
      'speech-section',
      [
        [f.host, speaker(0)],
        [f.outsider, judgeSeat()],
      ],
      [1, 2, 3, 4, 5].map(speaker),
    );
    const { roundId } = await launchRuntimeRound(f, room);
    const freezeRevision = await playedAndFrozen(f, roundId);
    await seedSettledAttendanceLedger(f, roundId);
    const round = (await f.store.getRound(roundId))!;
    const speakers = round.participants
      .flatMap((p) => (p.seat.kind === 'speaker' ? [p] : []))
      .sort((a, b) => b.seat.slot - a.seat.slot)
      .map((p) => p.id);
    await submitHumanBallot(
      f,
      roundId,
      f.outsider.actorId,
      freezeRevision,
      rankingBallot('rank-speakers@1', speakers),
    );
    assert({
      given:
        'the six-speaker section with a person and five bot debaters in its speaker seats, launched, played and frozen, then its judge ranking the speakers last seat first',
      should:
        'seat the bots as speakers, freeze the speaker ranking and complete with the six speaker seats in that order',
      actual: {
        speakers: speakers.length,
        bots: await f.sql<{ bots: number }[]>`select count(*)::int as bots
          from round_participants p join actors a on a.id=p.actor_id
          where p.round_id=${roundId} and p.seat_kind='speaker' and a.kind='bot'`.then(
          ([row]) => row!.bots,
        ),
        judging: await judgingOf(f, roundId),
        result: await resultOf(f, roundId),
      },
      expected: {
        speakers: 6,
        bots: 5,
        judging: { ballot: 'rank-speakers@1', panel: 'rank_sum' },
        result: {
          status: 'completed',
          outcome: {
            kind: 'ranking',
            of: 'speakers',
            places: speakers.map((id) => [id]),
          },
          ballots: 1,
        },
      },
    });
  }, botAdmissionForTests);
});

test('an open conversation opens both microphones and completes with no outcome and no ballot (TAB-6.18)', async () => {
  await withRoomRuntime(async (f) => {
    const room = await seatedRoom(
      f,
      'open-conversation',
      [
        [f.host, { kind: 'speaker', slot: 0 }],
        [f.guest, { kind: 'speaker', slot: 1 }],
      ],
      [],
    );
    const { roundId } = await launchRuntimeRound(f, room);
    const round = (await f.store.getRound(roundId))!;
    // Into the open segment: past the countdown, well before its end.
    await f.sql`update rounds set started_at=clock_timestamp()-${round.rules.countdownMs + 5_000}*interval '1 millisecond' where id=${roundId}`;
    await f.store.executeRoundTick({
      roundId,
      buildProjection: roundTickProjection(createId),
    });
    const open = await f.sql<
      { speaker: number; holding: boolean }[]
    >`select (p.slot)::int as speaker, bool_or(i.ended_at is null) as holding
      from round_speaking_intervals i
      join round_participants p on p.id=i.round_participant_id and p.round_id=i.round_id
      join round_segments s on s.id=i.segment_id
      where i.round_id=${roundId} and s.rules_segment_key='OPEN'
      group by p.slot order by p.slot`.then((rows) => [...rows]);
    // The conversation played to its end long ago, both open streams captured.
    await passAttendanceCutoff(f.sql, roundId);
    await f.sql`insert into transcript_segments(round_id,segment_id,round_participant_id,state,chunk_count,sealed_chunk_count,sealed_at)
      select distinct i.round_id,i.segment_id,i.round_participant_id,'complete',0,0,clock_timestamp()
      from round_speaking_intervals i where i.round_id=${roundId}`;
    // The maintenance pass that freezes a Round and completes its panel.
    await finalizeByMaintenance(f, roundId);
    const frozen = await f.sql<
      { completeness: string }[]
    >`select completeness from round_transcript_freezes where round_id=${roundId}`;
    assert({
      given:
        'the open conversation launched with two people seated and its one open segment running',
      should:
        'hold the floor open for both speakers at once, then complete with no outcome, no judging and no ballot',
      actual: {
        open,
        frozen: frozen.map((row) => row.completeness),
        judging: await judgingOf(f, roundId),
        result: await resultOf(f, roundId),
      },
      expected: {
        open: [
          { speaker: 0, holding: true },
          { speaker: 1, holding: true },
        ],
        frozen: ['complete'],
        judging: { ballot: null, panel: null },
        result: { status: 'completed', outcome: null, ballots: 0 },
      },
    });
  }, botAdmissionForTests);
});

test('a person leaving an open conversation is recorded absent and the conversation goes on (TAB-6.8)', async () => {
  await withRoomRuntime(async (f) => {
    const room = await seatedRoom(
      f,
      'open-conversation',
      [
        [f.host, { kind: 'speaker', slot: 0 }],
        [f.guest, { kind: 'speaker', slot: 1 }],
      ],
      [],
    );
    const { roundId, operations } = await launchRuntimeRound(f, room);
    const launched = (await f.store.getRound(roundId))!;
    await f.sql`update rounds set started_at=clock_timestamp()-${launched.rules.countdownMs + 5_000}*interval '1 millisecond' where id=${roundId}`;
    await f.store.executeRoundTick({
      roundId,
      buildProjection: roundTickProjection(createId),
    });
    const before = (await f.store.getRound(roundId))!;
    const seat = before.participants.find(
      (p) => p.actorId === f.guest.actorId,
    )!;
    await operations.command(
      { kind: 'human', actorId: f.guest.actorId },
      roundId,
      {
        version: 1,
        commandId: createId(),
        expectedVersion: before.version,
        command: { type: 'leave', participantId: seat.id },
      },
    );
    const after = (await f.store.getRound(roundId))!;
    const held = await f.sql<{ actor_id: string }[]>`select actor_id
      from active_seats where room_id=${room.id} order by actor_id`;
    assert({
      given:
        'the open conversation running, then one of its two people leaving through the round command',
      should:
        'keep the Round active with that seat absent, and free only the person who left',
      actual: {
        status: after.status,
        absent: after.checkpoint.absent_participant_ids,
        held: held.map((row) => row.actor_id),
      },
      expected: {
        status: 'active',
        absent: [seat.id],
        held: [f.host.actorId],
      },
    });
  }, botAdmissionForTests);
});
