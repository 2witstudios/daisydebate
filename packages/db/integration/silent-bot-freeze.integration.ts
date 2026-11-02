import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { finalizationState } from '../src/transcript-finalization-state';
import {
  closeUnresolvedStreams,
  lockFinalizationStreams,
} from '../src/transcript-finalization-streams';
import { createBotSeat } from './bot-seat.test-support';
import { withBoundedRound } from './bounded-transaction.test-support';
import type { Fixture } from './constraint-helpers';

setupRitewayBun();
requireTestServices(process.env);

const before = '2026-10-22T12:00:00.000Z';
const cutoff = '2026-10-22T12:02:00.000Z';
const start = new Date('2026-10-22T11:50:00.000Z');
const end = new Date('2026-10-22T11:53:00.000Z');

/** Both debaters hold the floor for the whole cross-examination, as PR 544 opens it. */
async function crossExamination(fixture: Fixture, roundId: string) {
  const asker = await fixture.seat(roundId, 'affirmative');
  const respondent = await createBotSeat(fixture, roundId, 'negative');
  const segmentId = createId();
  await fixture.insert('round_segments', {
    id: segmentId,
    round_id: roundId,
    sequence: 0,
    type: 'cross_ex',
    rules_segment_key: 'CX',
    started_at: start,
    ended_at: end,
    duration_ms: end.getTime() - start.getTime(),
  });
  for (const seat of [asker, respondent])
    await fixture.sql.unsafe(
      'insert into round_speaking_intervals(id,round_id,segment_id,round_participant_id,started_at,ended_at,started_version,ended_version) values($1,$2,$3,$4,$5,$6,1,2)',
      [createId(), roundId, segmentId, seat.id, start, end],
    );
  return { asker: asker.id, respondent: respondent.id, segmentId };
}
type Seats = Awaited<ReturnType<typeof crossExamination>>;

const sealed = (
  fixture: Fixture,
  roundId: string,
  segmentId: string,
  roundParticipantId: string,
  state: 'complete' | 'partial',
) =>
  fixture.insert(
    'transcript_segments',
    {
      round_id: roundId,
      segment_id: segmentId,
      round_participant_id: roundParticipantId,
      state,
      chunk_count: 0,
      sealed_chunk_count: 0,
      sealed_at: end,
    },
    'segment_id',
  );

const credit = (
  fixture: Fixture,
  roundId: string,
  segmentId: string,
  roundParticipantId: string,
) =>
  fixture.insert('round_bot_publication_windows', {
    id: createId(),
    round_id: roundId,
    segment_id: segmentId,
    round_participant_id: roundParticipantId,
    credited_from: start,
    credited_until: new Date(start.getTime() + 1000),
  });

/** The freeze's own read and decision, then the rows closing leaves behind. */
const freezeOf = async (
  setup: (fixture: Fixture, roundId: string, seats: Seats) => Promise<unknown>,
) => {
  let result:
    | {
        readonly beforeCutoff: string;
        readonly atCutoff: string;
        readonly asker: string | null;
        readonly respondent: string | null;
      }
    | undefined;
  await withBoundedRound(async (fixture, transaction, roundId) => {
    try {
      const seats = await crossExamination(fixture, roundId);
      await setup(fixture, roundId, seats);
      const decided = await transaction(async (tx) => {
        const facts = await lockFinalizationStreams(tx, roundId);
        await closeUnresolvedStreams(tx, roundId, facts);
        return {
          beforeCutoff: finalizationState(facts, before, cutoff),
          atCutoff: finalizationState(facts, cutoff, cutoff),
        };
      });
      const rowOf = async (seat: string) => {
        const [row] = await fixture.sql<{ state: string }[]>`select state
          from transcript_segments where segment_id=${seats.segmentId}
          and round_participant_id=${seat}`;
        return row?.state ?? null;
      };
      result = {
        ...decided,
        asker: await rowOf(seats.asker),
        respondent: await rowOf(seats.respondent),
      };
    } finally {
      await fixture.sql`delete from rounds where id=${roundId}`;
    }
  });
  return result;
};

test('a bot respondent that never spoke is not a capture gap (ISSUE-965)', async () => {
  assert({
    given:
      'a cross-examination whose bot respondent published nothing and whose human asker sealed complete',
    should: 'freeze complete without waiting and invent no partial row',
    actual: await freezeOf((fixture, roundId, seats) =>
      sealed(fixture, roundId, seats.segmentId, seats.asker, 'complete'),
    ),
    expected: {
      beforeCutoff: 'complete',
      atCutoff: 'complete',
      asker: 'complete',
      respondent: null,
    },
  });
});

test('a bot that published and lost its audio still freezes incomplete (ISSUE-965)', async () => {
  assert({
    given: 'a credited bot publication with no captured stream',
    should: 'wait for it, then record it partial and freeze incomplete',
    actual: await freezeOf(async (fixture, roundId, seats) => {
      await sealed(fixture, roundId, seats.segmentId, seats.asker, 'complete');
      await credit(fixture, roundId, seats.segmentId, seats.respondent);
    }),
    expected: {
      beforeCutoff: 'capture',
      atCutoff: 'incomplete',
      asker: 'complete',
      respondent: 'partial',
    },
  });
  assert({
    given: 'a credited bot publication whose stream sealed partial',
    should: 'freeze incomplete',
    actual: await freezeOf(async (fixture, roundId, seats) => {
      await sealed(fixture, roundId, seats.segmentId, seats.asker, 'complete');
      await credit(fixture, roundId, seats.segmentId, seats.respondent);
      await sealed(
        fixture,
        roundId,
        seats.segmentId,
        seats.respondent,
        'partial',
      );
    }),
    expected: {
      beforeCutoff: 'incomplete',
      atCutoff: 'incomplete',
      asker: 'complete',
      respondent: 'partial',
    },
  });
});

test('a human whose microphone died during a grant still freezes incomplete (ISSUE-965)', async () => {
  assert({
    given: 'a human grant with no captured stream and a silent bot respondent',
    should: 'wait for it, then record it partial and freeze incomplete',
    actual: await freezeOf(async () => {}),
    expected: {
      beforeCutoff: 'capture',
      atCutoff: 'incomplete',
      asker: 'partial',
      respondent: null,
    },
  });
});
