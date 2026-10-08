import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createDatabase } from '../src';
import { withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);
const instant = '2026-10-07T12:00:00.000Z';
type Fixture = Parameters<Parameters<typeof withFixture>[1]>[0];

const liveSegment = async (
  fixture: Fixture,
  role: 'affirmative' | 'negative',
  type: 'speech' | 'cross_ex',
  key: string,
  durationMs: number,
) => {
  const roundId = await fixture.round({
    status: 'active',
    current_stage: 'live',
    started_at: new Date(instant),
  });
  const seat = await fixture.seat(roundId, role);
  const segmentId = createId();
  await fixture.insert('round_segments', {
    id: segmentId,
    round_id: roundId,
    sequence: 0,
    type,
    rules_segment_key: key,
    started_at: new Date(instant),
    duration_ms: durationMs,
  });
  return { roundId, seat, segmentId };
};

test('a delayed AI phrase cannot land on or replace a closed segment', async () => {
  await withFixture(url, async (fixture) => {
    const { roundId, seat, segmentId } = await liveSegment(
      fixture,
      'affirmative',
      'speech',
      'AC',
      240_000,
    );
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

test('concurrent AI openings leave one durable line in a segment', async () => {
  await withFixture(url, async (fixture) => {
    const { roundId, seat, segmentId } = await liveSegment(
      fixture,
      'negative',
      'cross_ex',
      'CX',
      120_000,
    );
    const ids = [createId(), createId()];
    for (const id of ids) fixture.track('utterances', id);
    const database = createDatabase({ url, nextActorId: createId });
    try {
      const results = await Promise.all(
        ids.map((id) =>
          database.appendUtterance({
            id,
            roundId,
            segmentId,
            roundParticipantId: seat.id,
            text: 'An opening question.',
            requireOpen: true,
            requireEmptySegment: true,
          }),
        ),
      );
      const rows = await fixture.sql.unsafe(
        'select id from utterances where segment_id = $1',
        [segmentId],
      );
      assert({
        given: 'two openings for the same live segment',
        should: 'store exactly one while the other reports the lost race',
        actual: { results: results.sort(), count: rows.length },
        expected: { results: [false, true], count: 1 },
      });
    } finally {
      await database.close();
    }
  });
});

test('speech claims fence concurrent and expired writers', async () => {
  await withFixture(url, async (fixture) => {
    const { roundId, seat, segmentId } = await liveSegment(
      fixture,
      'negative',
      'speech',
      'NC',
      240_000,
    );
    const ids = [createId(), createId()];
    for (const id of ids) fixture.track('utterances', id);
    const database = createDatabase({ url, nextActorId: createId });
    try {
      const claims = await Promise.all(
        ids.map((id, index) =>
          database.claimSpeech({
            id,
            roundId,
            segmentId,
            roundParticipantId: seat.id,
            token: `writer-${index}`,
          }),
        ),
      );
      assert({
        given: 'two writers claiming one bot speech concurrently',
        should: 'grant one claim and hold the other',
        actual: claims.map((claim) => claim.status).sort(),
        expected: ['claimed', 'held'],
      });
      const winner = claims.findIndex((claim) => claim.status === 'claimed');
      const utteranceId = claims[winner]!.utteranceId;
      await database.releaseSpeech({
        utteranceId,
        roundId,
        token: `writer-${winner}`,
      });
      const resumed = await database.claimSpeech({
        id: createId(),
        roundId,
        segmentId,
        roundParticipantId: seat.id,
        token: 'resumed',
      });
      assert({
        given: 'the winning stream disconnects and releases its claim',
        should: 'let a new writer take over the same line immediately',
        actual: resumed,
        expected: { status: 'claimed', utteranceId },
      });
      await database.releaseSpeech({
        utteranceId,
        roundId,
        token: `writer-${winner}`,
      });
      const stillHeld = await database.claimSpeech({
        id: createId(),
        roundId,
        segmentId,
        roundParticipantId: seat.id,
        token: 'waiting',
      });
      assert({
        given: 'the stale writer releases again after another claim',
        should: 'leave the new claim held',
        actual: stillHeld.status,
        expected: 'held',
      });
      await fixture.sql.unsafe(
        "update utterances set generation_expires_at = statement_timestamp() - interval '1 second' where id = $1",
        [utteranceId],
      );
      const replacement = await database.claimSpeech({
        id: createId(),
        roundId,
        segmentId,
        roundParticipantId: seat.id,
        token: 'replacement',
      });
      assert({
        given: 'the first writer expired',
        should: 'take over its existing utterance id',
        actual: replacement,
        expected: { status: 'claimed', utteranceId },
      });
      await assertRejects({
        given: 'the expired writer attempts another phrase after takeover',
        should: 'refuse its stale token',
        actual: () =>
          database.replaceUtterance({
            id: utteranceId,
            roundId,
            text: 'Stale text',
            requireOpen: true,
            speechToken: 'resumed',
          }),
        code: 'CONFLICT',
      });
      await database.replaceUtterance({
        id: utteranceId,
        roundId,
        text: 'Final speech.',
        complete: true,
        requireOpen: true,
        speechToken: 'replacement',
      });
      const [row] = (await fixture.sql.unsafe(
        'select text, complete, generation_token from utterances where id = $1',
        [utteranceId],
      )) as Array<{
        text: string;
        complete: boolean;
        generation_token: string | null;
      }>;
      assert({
        given: 'the replacement writer finished',
        should: 'store only its complete text and release the claim',
        actual: row,
        expected: {
          text: 'Final speech.',
          complete: true,
          generation_token: null,
        },
      });
    } finally {
      await database.close();
    }
  });
});
