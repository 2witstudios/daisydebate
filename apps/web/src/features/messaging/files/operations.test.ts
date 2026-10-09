import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import type { FileScope, FileFrame } from '@daisy/db/messaging-files';
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

test('denied reservation allocates no identifiers before its fresh fence', async () => {
  const f = fileOperationFixture();
  let allocated = 0;
  const fenced = {
    ...f.frame,
    authorize: async () => {
      throw createAppError('AUTHORIZATION');
    },
  };
  const d = {
    ...f.d,
    ids: {
      next: () => {
        allocated++;
        return f.fileId;
      },
    },
    store: {
      withChannel: async <T>(
        _scope: FileScope,
        _capability: 'post' | 'read',
        work: (frame: FileFrame) => Promise<T>,
      ) => work(fenced),
    },
  };
  await assertRejects({
    given: 'a reservation denied by fresh canonical authority',
    should: 'refuse before generating file/object identifiers',
    actual: () =>
      reserveMessagingFile(
        {
          version: 1,
          channelId: f.channelId,
          requestId: 'r'.repeat(24),
          bytes: 100,
          filename: 'notes.pdf',
          mime: 'application/pdf',
        },
        f.principal,
        d,
      ),
    code: 'AUTHORIZATION',
  });
  assert({
    given: 'denied authority',
    should: 'leave ID allocation untouched',
    actual: allocated,
    expected: 0,
  });
});

test('wrong message association preserves a clean quarantine for the correct retry', async () => {
  const f = fileOperationFixture();
  f.frame.finalize = async () => {
    throw createAppError('NOT_FOUND');
  };
  const pending = finalizeMessagingFile(f.input, f.principal, f.d);
  await f.scanStarted;
  f.completeScan('clean');
  await assertRejects({
    given: 'a clean file finalized against an unavailable or foreign message',
    should: 'refuse the association',
    actual: () => pending,
    code: 'NOT_FOUND',
  });
  assert({
    given: 'an invalid association retry',
    should: 'preserve the existing clean quarantine',
    actual: f.state.cleanup,
    expected: 0,
  });
});

test('stale scan keeps the original conflict when canonical cleanup refuses a newer generation', async () => {
  const f = fileOperationFixture();
  f.frame.finalize = async () => {
    throw createAppError('CONFLICT');
  };
  const pending = finalizeMessagingFile(f.input, f.principal, {
    ...f.d,
    failPending: async () => {
      throw createAppError('AUTHORIZATION');
    },
  });
  await f.scanStarted;
  f.completeScan('clean');
  await assertRejects({
    given:
      'scan token became stale and cleanup correctly refuses the new generation',
    should:
      'preserve the original typed conflict without touching the newer upload',
    actual: () => pending,
    code: 'CONFLICT',
  });
});

test('infrastructure cleanup failure remains observable while its object stays charged', async () => {
  const f = fileOperationFixture();
  f.frame.finalize = async () => {
    throw createAppError('CONFLICT');
  };
  const pending = finalizeMessagingFile(f.input, f.principal, {
    ...f.d,
    failPending: async () => {
      throw createAppError('INFRASTRUCTURE');
    },
  });
  await f.scanStarted;
  f.completeScan('clean');
  await assertRejects({
    given: 'storage cleanup infrastructure fails after refused finalization',
    should:
      'surface infrastructure failure for retry instead of treating it as stale authority',
    actual: () => pending,
    code: 'INFRASTRUCTURE',
  });
});
