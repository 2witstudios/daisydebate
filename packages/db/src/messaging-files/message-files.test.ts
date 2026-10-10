import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { scopeFileFrame } from '../messaging/file-capability';
import {
  fileFrameFixture,
  fileRow,
  fileFramePolicy as policy,
  fileFrameScope as scope,
  fileFrameNow as now,
  fileFrameToken as token,
  fileFrameMessage as messageId,
} from './frame.test-support';
setupRitewayBun();

test('visible message attachment listing returns current public metadata only', async () => {
  const f = fileFrameFixture([
    [[token.fileId, token.generation, messageId]],
    fileRow({
      lifecycle: 'attached',
      messageId,
      storedBytes: 20,
      ownerActorId: 'p'.repeat(24),
    }),
    [[null]],
  ]);
  const listed = await scopeFileFrame(f.frame, 'read').listMessageFiles(
    [messageId, messageId],
    now,
    policy,
  );
  assert({
    given:
      'canonical visible message IDs and a surviving authorized peer attachment',
    should:
      'return only current public attachment metadata with actual stored bytes',
    actual: listed,
    expected: [
      {
        fileId: token.fileId,
        generation: 1,
        messageId,
        filename: 'notes.pdf',
        mime: 'application/pdf',
        bytes: 20,
      },
    ],
  });
  assert({
    given: 'the actual listing and per-file access queries',
    should:
      'deduplicate visible IDs, scope channel/attached/nonremoved rows and repeat current read authority',
    actual: [
      f.calls[0]!.params,
      f.calls[0]!.query.includes('inner join'),
      f.calls[0]!.query.includes('"removed_at" is null'),
      f.state.authorizations,
      f.writes().length,
      f.remaining.length,
    ],
    expected: [[scope.channelId, 'attached', messageId], true, true, 2, 0, 0],
  });
});

test('post capability cannot use listing or access to widen its selected authority', async () => {
  const f = fileFrameFixture([]);
  const post = scopeFileFrame(f.frame, 'post');
  for (const operation of [
    () => post.access(token, now, policy),
    () => post.listMessageFiles([messageId], now, policy),
  ])
    await assertRejects({
      given: 'the frame selected only current post authority',
      should: 'refuse read methods before any provider callback',
      actual: operation,
      code: 'AUTHORIZATION',
    });
  assert({
    given: 'post-only read refusal',
    should: 'leave provider and persistence untouched',
    actual: [f.state.authorizations, f.calls.length],
    expected: [0, 0],
  });
});

test('authority revocation during listing prevents every private per-file read', async () => {
  const f = fileFrameFixture([[[token.fileId, 1, messageId]]]);
  f.state.denyAfter = 1;
  await assertRejects({
    given: 'current read authority changes after discovery',
    should: 'refuse the list before file metadata access',
    actual: () => f.frame.listMessageFiles([messageId], now, policy),
    code: 'AUTHORIZATION',
  });
  assert({
    given: 'mid-list authority refusal',
    should: 'stop after the candidate query with no file query or mutation',
    actual: [f.calls.length, f.writes().length],
    expected: [1, 0],
  });
});

test('a changed message association cannot publish a different visible-history scope', async () => {
  const f = fileFrameFixture([
    [[token.fileId, 1, messageId]],
    fileRow({
      lifecycle: 'attached',
      messageId: 'n'.repeat(24),
      storedBytes: 20,
    }),
    [[null]],
  ]);
  await assertRejects({
    given: 'the attachment association changes after discovery',
    should: 'refuse metadata under the old message identity',
    actual: () => f.frame.listMessageFiles([messageId], now, policy),
    code: 'CONFLICT',
  });
});

test('absent file policy never turns even empty history into an enabled reader', async () => {
  const f = fileFrameFixture([]);
  await assertRejects({
    given: 'inconsistent injected file policy',
    should: 'remain unavailable before discovery',
    actual: () =>
      f.frame.listMessageFiles([], now, { ...policy, maxStoredBytes: 10 }),
    code: 'INFRASTRUCTURE',
  });
  assert({
    given: 'disabled listing policy',
    should: 'issue no persistence query',
    actual: f.calls.length,
    expected: 0,
  });
});

test('empty history still requires current authority and valid policy without a file query', async () => {
  const f = fileFrameFixture([]);
  assert({
    given: 'no visible messages',
    should: 'return no attachment metadata',
    actual: await f.frame.listMessageFiles([], now, policy),
    expected: [],
  });
  f.state.allowed = false;
  await assertRejects({
    given: 'authority revoked with an empty history',
    should: 'refuse rather than bypass the current fence',
    actual: () => f.frame.listMessageFiles([], now, policy),
    code: 'AUTHORIZATION',
  });
  assert({
    given: 'empty authorized or refused history',
    should: 'issue no protected query',
    actual: f.calls.length,
    expected: 0,
  });
});

test('removed, deleting and erased associations produce no history attachment', async () => {
  const f = fileFrameFixture([[]]);
  assert({
    given:
      'the current channel/message join excludes removed and nonattached rows',
    should: 'return no historical personal attachment association',
    actual: await f.frame.listMessageFiles([messageId], now, policy),
    expected: [],
  });
  assert({
    given: 'empty attachment discovery',
    should: 'avoid protected per-file reads',
    actual: f.calls.length,
    expected: 1,
  });
});

test('list access refuses stale generation instead of publishing metadata', async () => {
  const f = fileFrameFixture([
    [[token.fileId, 1, messageId]],
    fileRow({
      lifecycle: 'attached',
      messageId,
      storedBytes: 20,
      generation: 2,
    }),
  ]);
  await assertRejects({
    given: 'a candidate superseded before its access fence',
    should: 'refuse the stale attachment list',
    actual: () => f.frame.listMessageFiles([messageId], now, policy),
    code: 'CONFLICT',
  });
  assert({
    given: 'superseded listing',
    should: 'leave durable state unchanged',
    actual: f.writes().length,
    expected: 0,
  });
});

test('listing refuses a message removed at the final per-file access fence', async () => {
  const f = fileFrameFixture([
    [[token.fileId, 1, messageId]],
    fileRow({ lifecycle: 'attached', messageId, storedBytes: 20 }),
    [[new Date(now)]],
  ]);
  await assertRejects({
    given: 'a message becomes removed before access completion',
    should: 'refuse attachment metadata replay',
    actual: () => f.frame.listMessageFiles([messageId], now, policy),
    code: 'NOT_FOUND',
  });
});

test('invalid visible message IDs and read time refuse before discovery', async () => {
  for (const [ids, time] of [
    [[messageId, 'bad'], now],
    [[messageId], 'not-a-time'],
  ] as const) {
    const f = fileFrameFixture([]);
    await assertRejects({
      given: 'invalid history listing boundary input',
      should: 'refuse before querying private attachment associations',
      actual: () => f.frame.listMessageFiles(ids, time, policy),
      code: 'VALIDATION',
    });
    assert({
      given: 'invalid message listing',
      should: 'perform no query or write',
      actual: f.calls.length,
      expected: 0,
    });
  }
});
