import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import type { FileFrame } from '../messaging-files';
import { scopeFileFrame } from './file-capability';
setupRitewayBun();
test('a file read frame cannot admit or mutate an upload', async () => {
  let invoked = 0;
  const operation = async () => {
    invoked += 1;
    throw new Error('Must not invoke provider');
  };
  const frame: FileFrame = {
    authorize: operation,
    reserve: operation,
    upload: operation,
    scan: operation,
    quarantine: operation,
    renew: operation,
    finalize: operation,
    cancel: operation,
    access: operation,
  };
  const read = scopeFileFrame(frame, 'read');
  for (const method of [
    'authorize',
    'reserve',
    'upload',
    'scan',
    'quarantine',
    'renew',
    'finalize',
    'cancel',
  ] as const)
    await assertRejects({
      given: `a read capability invoking ${method}`,
      should: 'refuse before touching its provider',
      actual: async () =>
        (read[method] as (...args: never[]) => Promise<unknown>)(),
      code: 'AUTHORIZATION',
    });
  assert({
    given: 'every rejected file mutation',
    should: 'leave the underlying provider untouched',
    actual: invoked,
    expected: 0,
  });
});
