import { assert, setupRitewayBun, test } from 'riteway/bun';
import { resolve } from 'node:path';

setupRitewayBun();

const MODEL = [
  'floor-state.ts',
  'floor-events.ts',
  'floor-effects.ts',
  'floor-step.ts',
  'reduce-floor.ts',
  'reduce-floor-entry.ts',
  'reduce-floor-reads.ts',
];
const AMBIENT =
  /\b(setTimeout|setInterval|Date\.|new Date|performance\.|Math\.random|window\.|document\.|localStorage|sessionStorage|fetch\(|systemClock)/;
/** Value imports the model may make; a type import is erased and reads nothing. */
const ALLOWED = new Set([
  './history',
  ...MODEL.map((path) => `./${path.replace(/\.ts$/, '')}`),
]);

test('the floor model reads no clock, timer, network or framework', async () => {
  const problems: string[] = [];
  for (const path of MODEL) {
    const text = await Bun.file(resolve(import.meta.dir, path)).text();
    if (AMBIENT.test(text)) problems.push(`${path}: ambient effect`);
    for (const [, kind, spec] of text.matchAll(
      /import (type )?[^;]*? from '([^']+)'/g,
    ))
      if (!kind && !ALLOWED.has(spec!))
        problems.push(`${path}: imports ${spec}`);
  }
  assert({
    given: 'every module of the floor model',
    should: 'decide only from its inputs',
    actual: problems,
    expected: [],
  });
});
