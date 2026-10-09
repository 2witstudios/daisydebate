import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import {
  finalizeMessagingFile,
  reserveMessagingFile,
  uploadMessagingFile,
} from './operations';
import { fileOperationFixture } from './operations.test-support';
setupRitewayBun();
test('async clean scan cannot attach after current authority is revoked', async () => {
  const f = fileOperationFixture();
  const pending = finalizeMessagingFile(f.input, f.principal, f.d);
  await f.scanStarted;
  f.state.allowed = false;
  f.completeScan('clean');
  await assertRejects({
    given: 'clean scan completion after revocation',
    should: 'recheck current post authority before attachment',
    actual: () => pending,
    code: 'AUTHORIZATION',
  });
  assert({
    given: 'late allow completion',
    should: 'leave attachment uncommitted and schedule pending cleanup',
    actual: {
      commits: f.state.commits,
      cleanup: f.state.cleanup,
      calls: f.calls,
    },
    expected: {
      commits: 0,
      cleanup: 1,
      calls: ['post', 'protected-read', 'post'],
    },
  });
});
test('slow successful scan cannot renew its original service deadline', async () => {
  const f = fileOperationFixture();
  const pending = finalizeMessagingFile(f.input, f.principal, f.d);
  await f.scanStarted;
  f.state.now = '2026-10-09T18:00:01.000Z';
  f.completeScan('clean');
  await assertRejects({
    given: 'clean callback at the elapsed service deadline',
    should: 'refuse commit',
    actual: () => pending,
    code: 'CONFLICT',
  });
  assert({
    given: 'an expired async attempt',
    should: 'leave attachments untouched',
    actual: f.state.commits,
    expected: 0,
  });
});
test('reservation response excludes internal object and owner identifiers', async () => {
  const f = fileOperationFixture();
  const response = await reserveMessagingFile(
    {
      version: 1,
      channelId: f.channelId,
      requestId: 'r'.repeat(24),
      filename: 'notes.pdf',
      mime: 'application/pdf',
      bytes: 1024,
    },
    f.principal,
    f.d,
  );
  assert({
    given: 'a successful reservation',
    should: 'return only the scoped client contract',
    actual: Object.keys(response).sort(),
    expected: [
      'bytes',
      'expiresAt',
      'fileId',
      'filename',
      'generation',
      'mime',
    ],
  });
});
test('changed upload retry leaves existing immutable quarantine unchanged', async () => {
  const f = fileOperationFixture();
  await assertRejects({
    given: 'a quarantined object retried with different PDF bytes',
    should: 'refuse overwrite',
    actual: () =>
      uploadMessagingFile(
        { version: 1, channelId: f.channelId, fileId: f.fileId, generation: 1 },
        new TextEncoder().encode('%PDF-1.7\nother\n%%EOF'),
        f.principal,
        f.d,
      ),
    code: 'CONFLICT',
  });
  assert({
    given: 'an unequal upload replay',
    should: 'neither rewrite nor clean up the existing object',
    actual: { calls: f.calls, cleanup: f.state.cleanup },
    expected: { calls: ['post'], cleanup: 0 },
  });
});
