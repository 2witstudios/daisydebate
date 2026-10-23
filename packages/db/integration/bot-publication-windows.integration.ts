import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import {
  claimAtFloorStart,
  withBotPublication,
} from './bot-publication.test-support';
setupRitewayBun();
requireTestServices(process.env);
test('authorized windows are stored as credited runs and refused ones are not (DEC-212, DEC-218)', async () => {
  await withBotPublication(async ({ operations, target, fixture }) => {
    const { claim, start } = await claimAtFloorStart({
      operations,
      target,
      fixture,
    });
    await operations.verifyBotPublication(claim.scope, claim.token);
    for (const [before, after] of [
      [1, 11],
      [11, 21],
      [100, 110],
      [15, 30],
    ])
      await operations.verifyBotPublication(claim.scope, claim.token, {
        beforeMs: start + before!,
        afterMs: start + after!,
      });
    await operations
      .verifyBotPublication(claim.scope, claim.token, {
        beforeMs: start - 1,
        afterMs: start + 9,
      })
      .catch(() => undefined);
    const rows =
      await fixture.sql`select credited_from,credited_until from round_bot_publication_windows where round_id=${target.roundId} and segment_id=${target.segmentId} and round_participant_id=${target.roundParticipantId} order by credited_from`;
    assert({
      given:
        'a plain verification, touching and overlapping windows, a separate one and a refused bracket',
      should: 'store one credited row per contiguous run, nothing else',
      actual: rows.map((row: { credited_from: Date; credited_until: Date }) => [
        row.credited_from.getTime() - start,
        row.credited_until.getTime() - start,
      ]),
      expected: [
        [1, 30],
        [100, 110],
      ],
    });
  });
});
test('a window credit after its stream sealed is refused and stores nothing (ISSUE-488-r1)', async () => {
  await withBotPublication(async ({ operations, target, fixture }) => {
    const { claim, start } = await claimAtFloorStart({
      operations,
      target,
      fixture,
    });
    await operations.verifyBotPublication(claim.scope, claim.token, {
      beforeMs: start + 1,
      afterMs: start + 11,
    });
    await fixture.sql`insert into transcript_segments(round_id,segment_id,round_participant_id,state,chunk_count,sealed_chunk_count,sealed_at) values(${target.roundId},${target.segmentId},${target.roundParticipantId},'complete',0,0,clock_timestamp())`;
    await assertRejects({
      given: 'a final window authorized after the per-segment seal',
      should: 'refuse the credit, since the seal never required it',
      actual: () =>
        operations.verifyBotPublication(claim.scope, claim.token, {
          beforeMs: start + 11,
          afterMs: start + 21,
        }),
      code: 'CONFLICT',
    });
    const rows =
      await fixture.sql`select credited_from,credited_until from round_bot_publication_windows where round_id=${target.roundId}`;
    assert({
      given: 'a credit before the seal and a refused one after it',
      should: 'keep only the credit the seal could read',
      actual: rows.map((row: { credited_from: Date; credited_until: Date }) => [
        row.credited_from.getTime() - start,
        row.credited_until.getTime() - start,
      ]),
      expected: [[1, 11]],
    });
  });
});
