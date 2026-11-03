import { Glob } from 'bun';
import { resolve } from 'node:path';
import { assert, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

const source = resolve(import.meta.dir, '..');
const RUNTIME_IMPORT = /^import\s+(?!type\b)(?:[^;]*?\s+from\s+)?'([^']+)';/m;

const firstRuntimeImport = (text: string) =>
  RUNTIME_IMPORT.exec(text)?.[1] ?? null;

test('every browser owner turns Zod JIT off before anything else loads', async () => {
  const late: string[] = [];
  let owners = 0;
  for await (const path of new Glob('**/*.{ts,tsx}').scan(source)) {
    const text = await Bun.file(resolve(source, path)).text();
    if (!/import '[^']*zod-jitless';/.test(text)) continue;
    owners++;
    if (!firstRuntimeImport(text)?.endsWith('zod-jitless')) late.push(path);
  }
  assert({
    given:
      'the compiled bundle evaluates imports in order and merges modules into shared scopes',
    should:
      'load zod-jitless first, because any earlier import can build a protocol schema under the nonce CSP',
    actual: { late: late.sort(), someOwners: owners > 0 },
    expected: { late: [], someOwners: true },
  });
});
