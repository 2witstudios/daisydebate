import { sql } from 'drizzle-orm';
import { databaseClockRow } from '../src/database-clock';
import {
  observationReactionCounts,
  observationWindowRow,
} from '../src/messaging/observation-reads';
import { query } from '../src/raw-rows';

const iterations = 15_000;
const warmup = 2_000;
const clockRows = [{ now: new Date('2026-01-01T12:00:00.000Z') }];
const execute = async () => clockRows;
const statement = sql`select clock_timestamp() as now`;
const historyRows = Array.from({ length: 101 }, (_, offset) => ({
  id: offset.toString(36).padStart(24, 'm'),
  author_actor_id: 'a'.repeat(24),
  text: 'A committed message',
  reply_to_message_id: null,
  created_at: new Date('2026-01-01T12:00:00.000Z'),
  edited_at: null,
  removed_at: null,
  authority_revision: '2',
  change_version: '104',
  sequence: String(101 - offset),
  message_change_version: String(103 - offset),
  reactions: [
    { reaction: 'like', count: 3 },
    { reaction: 'agree', count: 2 },
  ],
}));
const executeHistory = async () => historyRows;
const historyStatement = sql`select * from public.daisy_observation_channel_messages(${'c'.repeat(24)}::text, ${100}::integer)`;

async function measure(work: () => number | Promise<number>) {
  let total = 0;
  for (let index = 0; index < warmup; index += 1) await work();
  const start = Bun.nanoseconds();
  for (let index = 0; index < iterations; index += 1) total += await work();
  return {
    microseconds: (Bun.nanoseconds() - start) / iterations / 1_000,
    total,
  };
}

const rawClock = await measure(
  async () => (await execute())[0]?.now.getTime() ?? 0,
);
const parsedClock = await measure(async () => {
  const [row] = await query({ execute }, databaseClockRow, statement);
  return row?.now.getTime() ?? 0;
});
// The parent validated shared reaction counts but trusted the surrounding row.
const rawHistory = await measure(async () =>
  (await executeHistory()).reduce(
    (count, row) =>
      count +
      Number(row.sequence) +
      observationReactionCounts.parse(row.reactions).length,
    0,
  ),
);
const parsedHistory = await measure(async () =>
  (
    await query(
      { execute: executeHistory },
      observationWindowRow,
      historyStatement,
    )
  ).reduce(
    (count, row) => count + Number(row.sequence) + (row.reactions?.length ?? 0),
    0,
  ),
);

for (const [scenario, raw, parsed] of [
  ['Round tick clock row', rawClock, parsedClock],
  ['Messaging observation history (101 full rows)', rawHistory, parsedHistory],
] as const) {
  if (raw.total !== parsed.total)
    throw new Error(`Results differ for ${scenario}`);
  process.stdout.write(
    `${scenario}: ${raw.microseconds.toFixed(3)} µs parent decoding, ${parsed.microseconds.toFixed(3)} µs full row decoding\n`,
  );
}
