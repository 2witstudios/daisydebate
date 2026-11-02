import { assert, setupRitewayBun, test } from 'riteway/bun';
import { Glob } from 'bun';
import { resolve } from 'node:path';

setupRitewayBun();

const AMBIENT =
  /\b(setTimeout|setInterval|Date\.now|new Date|performance\.|Math\.random|window\.|document\.|localStorage|sessionStorage|fetch\()/;
const ALLOWED_OUTSIDE = new Set([
  '../media-read-intent',
  '../source-failure',
  '@daisy/protocol',
]);

test('the media model reads no clock, timer, storage, SDK or track handle', async () => {
  const problems: string[] = [];
  const folder = import.meta.dir;
  for await (const path of new Glob('*.ts').scan(folder)) {
    if (path.includes('.test')) continue;
    const text = await Bun.file(resolve(folder, path)).text();
    if (AMBIENT.test(text)) problems.push(`${path}: ambient effect`);
    for (const [, spec] of text.matchAll(/from '([^']+)'/g))
      if (!spec!.startsWith('./') && !ALLOWED_OUTSIDE.has(spec!))
        problems.push(`${path}: imports ${spec}`);
  }
  assert({
    given: 'every module of the pure media model',
    should: 'decide only from its inputs, never from an adapter or a handle',
    actual: problems,
    expected: [],
  });
});
