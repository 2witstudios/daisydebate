import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createDatabase } from '../src';
import { withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);
const instant = '2026-10-07T12:00:00.000Z';

test('a delayed AI phrase cannot land on or replace a closed segment', async () => {
  await withFixture(url, async (fixture) => {
    const roundId = await fixture.round({
      status: 'active',
      current_stage: 'live',
      started_at: new Date(instant),
    });
    const seat = await fixture.seat(roundId, 'affirmative');
    const segmentId = createId();
    await fixture.insert('round_segments', {
      id: segmentId,
      round_id: roundId,
      sequence: 0,
      type: 'speech',
      rules_segment_key: 'AC',
      started_at: new Date(instant),
      duration_ms: 240_000,
    });
    const utteranceId = createId();
    fixture.track('utterances', utteranceId);
    const database = createDatabase({ url, nextActorId: createId });
    try {
      await database.appendUtterance({
        id: utteranceId,
        roundId,
        segmentId,
        roundParticipantId: seat.id,
        text: 'Heard while live.',
        requireOpen: true,
      });
      await fixture.sql.unsafe(
        'update round_segments set ended_at = statement_timestamp() where id = $1',
        [segmentId],
      );
      await assertRejects({
        given: 'a model phrase produced after the segment closed',
        should: 'refuse an append under the segment row lock',
        actual: () =>
          database.appendUtterance({
            id: createId(),
            roundId,
            segmentId,
            roundParticipantId: seat.id,
            text: 'Too late.',
            requireOpen: true,
          }),
        code: 'CONFLICT',
      });
      await assertRejects({
        given: 'a later model phrase for an existing line',
        should: 'refuse a replacement under the same lock',
        actual: () =>
          database.replaceUtterance({
            id: utteranceId,
            roundId,
            text: 'Overwritten too late.',
            requireOpen: true,
          }),
        code: 'CONFLICT',
      });
      const [line] = (await fixture.sql.unsafe(
        'select text from utterances where id = $1',
        [utteranceId],
      )) as Array<{ text: string }>;
      assert({
        given: 'both late writes refused',
        should: 'preserve the words recorded while live',
        actual: line?.text,
        expected: 'Heard while live.',
      });
    } finally {
      await database.close();
    }
  });
});
