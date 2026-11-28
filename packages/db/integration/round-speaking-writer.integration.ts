import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { instantMs } from '@daisy/clock';
import { drizzle } from 'drizzle-orm/bun-sql';
import type { RoundSpeakingChange } from '@daisy/protocol/runtime';
import { writeSpeakingProjection } from '../src/round-speaking-writer';
import { withFixture } from './constraint-helpers';
import { validRules } from './round-fixtures';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const at = (seconds: number) =>
  new Date(
    instantMs('2026-11-27T10:00:00.000Z') + seconds * 1000,
  ).toISOString();

test('a pause confirmed before a later speakers change closes those intervals with no length, never inverted', async () => {
  await withFixture(databaseUrl, async (f) => {
    const {
      id: roundId,
      seats: [speaker, holder],
    } = await f.roundWithCast(
      { status: 'active', current_stage: 'live', started_at: new Date(at(0)) },
      [{ seat: 'affirmative' }, { seat: 'negative' }],
    );
    if (!speaker || !holder) throw new Error('Seats missing');
    const segmentId = createId();
    const rule = validRules.segments.find((s) => s.type === 'speech')!;
    await f.insert('round_segments', {
      id: segmentId,
      round_id: roundId,
      sequence: 0,
      type: 'speech',
      rules_segment_key: rule.key,
      started_at: new Date(at(0)),
      duration_ms: rule.durationMs,
    });
    const tx = drizzle({ client: f.sql });
    const write = (
      resultingVersion: number,
      speakingChanges: readonly RoundSpeakingChange[],
    ) =>
      writeSpeakingProjection(tx, {
        roundId,
        resultingVersion,
        commandId: null,
        projection: {
          round: null,
          segmentInserts: [],
          segmentCloses: [],
          effects: [],
          speakingChanges,
        },
      });
    // The speech opens for its speaker; at 103 s a point is accepted.
    await write(2, [
      { kind: 'open', segmentId, at: at(0), participantIds: [speaker.id] },
    ]);
    await write(3, [
      { kind: 'close', segmentId, at: at(103) },
      {
        kind: 'open',
        segmentId,
        at: at(103),
        participantIds: [speaker.id, holder.id],
      },
    ]);
    // A pause whose last confirmed audio was at 101 s stops the speech there.
    await write(4, [{ kind: 'close', segmentId, at: at(101) }]);
    const rows = (await f.sql`
      select round_participant_id as "participantId",
        extract(epoch from started_at - ${at(0)}::timestamptz)::int as "from",
        extract(epoch from ended_at - ${at(0)}::timestamptz)::int as "until"
      from round_speaking_intervals where round_id = ${roundId}
      order by started_at, round_participant_id`) as {
      participantId: string;
      from: number;
      until: number;
    }[];
    const byStart = (from: number) =>
      rows
        .filter((row) => row.from === from)
        .map((row) => row.until)
        .sort();
    assert({
      given:
        'a speech granted at 0 s, a point accepted at 103 s, then a pause confirmed only to 101 s',
      should:
        'keep the speaker’s confirmed interval, and close the unconfirmed point intervals with no length instead of refusing the pause',
      actual: { first: byStart(0), point: byStart(103), count: rows.length },
      expected: { first: [103], point: [103, 103], count: 3 },
    });
  });
});
