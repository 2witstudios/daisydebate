import {
  recordingSave,
  documentApi,
  manualDraftResources,
  memoryStorage,
  stored,
} from './document-sync.test-support';

import { assert, setupRitewayBun, test } from 'riteway/bun';
import { releaseDraftOwner } from './draft-owner';
import { createDocumentSync } from './document-sync';

import { newDraftCopy } from './document-draft';

setupRitewayBun();
const recoveryHtml = (raw: string | null): string | null =>
  raw === null ? null : (JSON.parse(raw).recovery?.html ?? null);
const fixture = () => {
  const storage = memoryStorage(),
    sent: string[] = [];
  const key = (principal: string, documentId: string) =>
    `daisy:document-drafts:copy:${principal}:${documentId}`;
  for (const [principal, documentId] of [
    ['p', 'a'],
    ['p', 'b'],
    ['q', 'b'],
  ] as const)
    storage.setItem(
      key(principal, documentId),
      JSON.stringify({
        recovery: newDraftCopy({
          generation: `${principal}-${documentId}`,
          html: 'REC',
          baseRevision: 1,
          now: 100,
        }),
      }),
    );
  const owner = (principalId: string, documentId: string) => ({
    principalId,
    sync: createDocumentSync({
      ...manualDraftResources(`${principalId}-${documentId}`, { storage }),

      api: documentApi(recordingSave(sent), () => [stored(documentId, 1)]),
      principalId,
      roundId: 'r',
      onConflict: () => {},
    }),
  });
  return { storage, sent, key, owner };
};

test('an owner replacement flushes pending text and preserves all same-principal recovery', async () => {
  const f = fixture(),
    previous = f.owner('p', 'a'),
    next = f.owner('p', 'b');
  await previous.sync.load();
  await next.sync.load();
  previous.sync.change('a', 'NEW');
  await releaseDraftOwner(previous, next);
  assert({
    given: 'the actual cleanup receives another owner for the same principal',
    should: 'flush and dispose the old owner without purging either recovery',
    actual: [
      f.sent,
      recoveryHtml(f.storage.getItem(f.key('p', 'a'))),
      f.storage.getItem(f.key('p', 'b')) !== null,
      previous.sync.available(),
      next.sync.available(),
    ],
    expected: [['NEW'], 'REC', true, false, true],
  });
});

test('account replacement purges the old principal and refuses late work without flushing it', async () => {
  const f = fixture(),
    previous = f.owner('p', 'a'),
    next = f.owner('q', 'b');
  await previous.sync.load();
  await next.sync.load();
  previous.sync.change('a', 'PRIVATE');
  await releaseDraftOwner(previous, next);
  previous.sync.change('a', 'LATE');
  await previous.sync.flush();
  assert({
    given: 'a replacement account and queued old-owner work',
    should:
      'purge the old principal across documents while retaining the new account and sending no old text',
    actual: [
      f.sent,
      f.storage.getItem(f.key('p', 'a')),
      f.storage.getItem(f.key('p', 'b')),
      f.storage.getItem(f.key('q', 'b')) !== null,
      previous.sync.available(),
    ],
    expected: [[], null, null, true, false],
  });
});

test('Strict Mode reattachment retains the same live owner and its pending edit', async () => {
  const f = fixture(),
    previous = f.owner('p', 'a');
  await previous.sync.load();
  previous.sync.change('a', 'NEW');
  await releaseDraftOwner(previous, { ...previous });
  const before = [previous.sync.available(), f.sent.length];
  await previous.sync.flush();
  assert({
    given: 'a new effect token reattaches the same owner',
    should: 'leave it live and queued until its ordinary save',
    actual: [before, f.sent],
    expected: [[true, 0], ['NEW']],
  });
});

test('a real unmount flushes and disposes without purging recovery', async () => {
  const f = fixture(),
    previous = f.owner('p', 'a');
  await previous.sync.load();
  previous.sync.change('a', 'NEW');
  await releaseDraftOwner(previous, previous);
  assert({
    given: 'the final token on ordinary unmount',
    should: 'drain the edit and retain explicit recovery for reopening',
    actual: [
      f.sent,
      previous.sync.available(),
      recoveryHtml(f.storage.getItem(f.key('p', 'a'))),
    ],
    expected: [['NEW'], false, 'REC'],
  });
});
