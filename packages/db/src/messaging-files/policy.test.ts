import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireFilePolicy } from './policy';
setupRitewayBun();
const policy = {
  maxFileBytes: 10,
  maxStoredBytes: 20,
  maxStoredFiles: 2,
  maxFilesPerMessage: 1,
  reservationMs: 100,
  accessMs: 10,
  maxFilenameUnits: 40,
  maxImagePixels: 100,
  serviceMs: 100,
};
test('file policy is explicit and has no missing or invalid production defaults', async () => {
  for (const input of [
    undefined,
    {},
    { ...policy, maxStoredFiles: 0 },
    { ...policy, maxFileBytes: 21 },
    { ...policy, serviceMs: 1.5 },
  ])
    await assertRejects({
      given: 'an absent, incomplete or inconsistent file policy',
      should: 'remain unavailable',
      actual: () =>
        requireFilePolicy(input as Parameters<typeof requireFilePolicy>[0]),
      code: 'INFRASTRUCTURE',
    });
  assert({
    given: 'an explicit valid injected policy',
    should: 'preserve owner-selected numeric values',
    actual: requireFilePolicy(policy),
    expected: policy,
  });
});
