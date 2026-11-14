/**
 * The long tier: several thousand simulated tournaments across the scenario
 * grid, with no service. It gates nothing; its output goes in the PR. Exits
 * non-zero, naming each seed, when the checker refused any answer.
 * Usage: bun run simulate:long [count]
 */
import { simulate } from '../src/simulate';
import { measure, measureLarge } from './performance-cases';

const count = Number(process.argv[2] ?? 2000);
const answers: Record<string, number> = {};
const rejected: string[] = [];
let calls = 0;
let shared = 0;
let slowest = 0;
const started = performance.now();
for (let n = 0; n < count; n += 1) {
  const seed = new Uint8Array(32);
  new DataView(seed.buffer).setUint32(0, n + 1_000_000, false);
  const before = performance.now();
  const report = simulate(seed, n % 2 === 0 ? 'small' : 'full');
  slowest = Math.max(slowest, Math.round(performance.now() - before));
  calls += report.calls;
  if (report.sharedSlots) shared += 1;
  for (const [kind, times] of Object.entries(report.answers))
    answers[kind] = (answers[kind] ?? 0) + times;
  if (report.rejections.length > 0)
    rejected.push(
      `${report.seed}: ${JSON.stringify(report.rejections.slice(0, 2))}`,
    );
}
const seconds = ((performance.now() - started) / 1000).toFixed(1);
process.stdout.write(
  [
    `tournaments: ${count} (${shared} with two or more events sharing slots)`,
    `draw calls: ${calls}; answers: ${JSON.stringify(answers)}`,
    `slowest tournament: ${slowest} ms; total: ${seconds} s`,
    'performance, best of three (typical size, target):',
    ...[...measure(), ...measureLarge()].map(
      (m) => `  ${m.ms} ms (target ${m.targetMs} ms)  ${m.method}`,
    ),
    `rejected by the checker: ${rejected.length}`,
    ...rejected.slice(0, 20),
    '',
  ].join('\n'),
);
process.exit(rejected.length === 0 ? 0 : 1);
