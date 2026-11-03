import { requireTestServices } from '@daisy/config';
import { emptyRuntimeCheckpoint } from '@daisy/protocol';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { writePrivateSpans } from '../src/round-projection-writer';
import { withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

const at = (seconds: number) =>
  new Date(
    Date.parse('2026-11-03T10:00:00.000Z') + seconds * 1000,
  ).toISOString();
const live = { status: 'active', currentStage: 'live' };
const idle = emptyRuntimeCheckpoint;
const prepping = {
  ...idle,
  active_prep: { side: 'affirmative' as const, started_at: at(10) },
};
const used = {
  ...idle,
  prep_consumed_ms: { affirmative: 30_000, negative: 0 },
};

test('prep and judging are committed by the transition, with the times they ran', async () => {
  const client = new SQL(databaseUrl, { max: 2 });
  try {
    await withFixture(databaseUrl, async (f) => {
      const roundId = await f.round();
      const db = drizzle({ client });
      const step = (
        before: { currentStage: string; runtimeState: unknown },
        after: {
          status: string;
          currentStage: string | null;
          checkpoint: unknown;
        },
        now: string,
        finalSegmentEndedAt?: string,
      ) =>
        writePrivateSpans(
          db as never,
          roundId,
          { status: 'active', ...before } as never,
          { round: after, finalSegmentEndedAt } as never,
          now,
        );
      const spans = async () =>
        (
          await client`select kind, started_at, ended_at from round_private_spans
            where round_id=${roundId} order by started_at`
        ).map(
          (row: { kind: string; started_at: Date; ended_at: Date | null }) => [
            row.kind,
            new Date(row.started_at).toISOString(),
            row.ended_at && new Date(row.ended_at).toISOString(),
          ],
        );
      await step(
        { currentStage: 'live', runtimeState: idle },
        { ...live, checkpoint: prepping },
        at(10),
      );
      const opened = await spans();
      await step(
        { currentStage: 'live', runtimeState: prepping },
        { ...live, checkpoint: used },
        at(500),
      );
      const closed = await spans();
      await step(
        { currentStage: 'live', runtimeState: used },
        { status: 'active', currentStage: 'awaiting_ballot', checkpoint: used },
        at(900),
        at(800),
      );
      await step(
        { currentStage: 'awaiting_ballot', runtimeState: used },
        { status: 'completed', currentStage: null, checkpoint: used },
        at(1000),
      );
      const finished = await spans();
      await client`delete from round_private_spans where round_id=${roundId}`;
      assert({
        given:
          'prep opening, closing late with 30 s used, then judging to the end',
        should:
          'open prep at its start, close it at the time used, and run judging from the final segment to the end',
        actual: [opened, closed, finished],
        expected: [
          [['prep', at(10), null]],
          [['prep', at(10), at(40)]],
          [
            ['prep', at(10), at(40)],
            ['judging', at(800), at(1000)],
          ],
        ],
      });
    });
  } finally {
    await client.close();
  }
});
