import { sql } from 'drizzle-orm';
import { databaseClockRow } from '../src/database-clock';
import { parseHistoryReactions } from '../src/messaging/read-frame';
import { query } from '../src/raw-rows';

const iterations = 15_000;
const warmup = 2_000;
const clockRows = [{ now: new Date('2026-01-01T12:00:00.000Z') }];
const execute = async () => clockRows;
const statement = sql`select clock_timestamp() as now`;
const historyRows = Array.from({ length: 101 }, () => ({
  reactions: [
    { reaction: 'like', count: 3, own: true },
    { reaction: 'agree', count: 2, own: false },
  ],
}));

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
const rawHistory = await measure(() =>
  historyRows.reduce((count, row) => count + row.reactions.length, 0),
);
const parsedHistory = await measure(() =>
  historyRows.reduce(
    (count, row) => count + parseHistoryReactions(row.reactions).length,
    0,
  ),
);

for (const [scenario, raw, parsed] of [
  ['Round tick clock row', rawClock, parsedClock],
  ['Messaging history (101 reaction rows)', rawHistory, parsedHistory],
] as const) {
  if (raw.total !== parsed.total)
    throw new Error(`Results differ for ${scenario}`);
  console.log(
    `${scenario}: ${raw.microseconds.toFixed(3)} µs without parsing, ${parsed.microseconds.toFixed(3)} µs with parsing`,
  );
}
