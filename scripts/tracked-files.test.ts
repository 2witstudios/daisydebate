import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { trackedFiles } from './tracked-files';

setupRitewayBun();

test('lists the repository files and throws when git cannot', () => {
  const outside = mkdtempSync(join(tmpdir(), 'tracked-files-'));
  let threw = false;
  try {
    trackedFiles(outside);
  } catch {
    threw = true;
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
  assert({
    given: 'this repository, and then a directory that is no repository',
    should: 'list the root manifest, and throw rather than list nothing',
    actual: {
      listed: trackedFiles(import.meta.dir + '/..').includes('package.json'),
      threw,
    },
    expected: { listed: true, threw: true },
  });
});
