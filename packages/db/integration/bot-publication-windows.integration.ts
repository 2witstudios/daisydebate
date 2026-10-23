import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import {
  claimAtFloorStart,
  withBotPublication,
} from './bot-publication.test-support';
setupRitewayBun();
requireTestServices(process.env);
type Harness = Parameters<Parameters<typeof withBotPublication>[0]>[0];
/** A claimed bot seat: credit windows by offset from its floor start, read stored runs back. */
const withClaimedFloor = (
  work: (floor: {
    readonly fixture: Harness['fixture'];
    readonly target: Harness['target'];
    readonly credit: (before?: number, after?: number) => Promise<void>;
    readonly credited: () => Promise<number[][]>;
  }) => Promise<void>,
) =>
  withBotPublication(async ({ operations, target, fixture }) => {
    const { claim, start } = await claimAtFloorStart({
      operations,
      target,
      fixture,
    });
    await work({
      fixture,
      target,
      credit: (before, after) =>
        operations.verifyBotPublication(
          claim.scope,
          claim.token,
          before === undefined
            ? undefined
            : { beforeMs: start + before, afterMs: start + after! },
        ),
      credited: async () =>
        (
          await fixture.sql`select credited_from,credited_until from round_bot_publication_windows where round_id=${target.roundId} and segment_id=${target.segmentId} and round_participant_id=${target.roundParticipantId} order by credited_from`
        ).map((row: { credited_from: Date; credited_until: Date }) => [
          row.credited_from.getTime() - start,
          row.credited_until.getTime() - start,
        ]),
    });
  });
test('authorized windows are stored as credited runs and refused ones are not (DEC-212, DEC-218)', async () => {
  await withClaimedFloor(async ({ credit, credited }) => {
    await credit();
    for (const [before, after] of [
      [1, 11],
      [11, 21],
      [100, 110],
      [15, 30],
    ])
      await credit(before, after);
    await credit(-1, 9).catch(() => undefined);
    assert({
      given:
        'a plain verification, touching and overlapping windows, a separate one and a refused bracket',
      should: 'store one credited row per contiguous run, nothing else',
      actual: await credited(),
      expected: [
        [1, 30],
        [100, 110],
      ],
    });
  });
});
test('a window credit after its stream sealed is refused and stores nothing (ISSUE-488-r1)', async () => {
  await withClaimedFloor(async ({ fixture, target, credit, credited }) => {
    await credit(1, 11);
    await fixture.sql`insert into transcript_segments(round_id,segment_id,round_participant_id,state,chunk_count,sealed_chunk_count,sealed_at) values(${target.roundId},${target.segmentId},${target.roundParticipantId},'complete',0,0,clock_timestamp())`;
    await assertRejects({
      given: 'a final window authorized after the per-segment seal',
      should: 'refuse the credit, since the seal never required it',
      actual: () => credit(11, 21),
      code: 'CONFLICT',
    });
    assert({
      given: 'a credit before the seal and a refused one after it',
      should: 'keep only the credit the seal could read',
      actual: await credited(),
      expected: [[1, 11]],
    });
  });
});
