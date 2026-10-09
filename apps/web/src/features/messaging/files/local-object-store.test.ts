import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createLocalPrivateObjectStore } from './local-object-store';
setupRitewayBun();
test('local object quarantine is private, immutable and deletion acknowledged', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'daisy-msg-files-'));
  const store = createLocalPrivateObjectStore(directory);
  const key = 'o'.repeat(24),
    bytes = new Uint8Array([1, 2, 3]);
  try {
    await store.put(key, bytes);
    assert({
      given: 'a private quarantined object',
      should: 'read only its bounded bytes',
      actual: Array.from(await store.read(key, 3)),
      expected: [1, 2, 3],
    });
    assert({
      given: 'quarantine storage',
      should: 'exclude group and world permissions',
      actual: (await stat(join(directory, key))).mode & 0o077,
      expected: 0,
    });
    await assertRejects({
      given: 'a request for an oversized object',
      should: 'fail before reading content',
      actual: () => store.read(key, 2),
      code: 'PAYLOAD_TOO_LARGE',
    });
    await assertRejects({
      given: 'a client controlled path',
      should: 'refuse traversal',
      actual: () => store.read('../private', 10),
      code: 'VALIDATION',
    });
    await assertRejects({
      given: 'a second write to an immutable object key',
      should: 'preserve the original object',
      actual: () => store.put(key, new Uint8Array([9])),
      code: 'INFRASTRUCTURE',
    });
    assert({
      given: 'an unequal retry',
      should: 'leave stored bytes unchanged',
      actual: Array.from(await store.read(key, 3)),
      expected: [1, 2, 3],
    });
    await store.remove(key);
    await store.remove(key);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
