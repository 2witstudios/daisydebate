import {
  recordingSave,
  documentApi,
  manualNoteResources,
  memoryStorage,
  stored,
} from './document-sync.test-support';

import { assert, setupRitewayBun, test } from 'riteway/bun';
import { releaseNoteOwner } from './note-owner';
import { createDocumentSync } from './document-sync';

import { newNoteCopy } from './note-draft';

setupRitewayBun();
const recoveryHtml = (raw: string | null): string | null =>
  raw === null ? null : (JSON.parse(raw).recovery?.html ?? null);
const fixture = () => {
  const storage = memoryStorage(),
    sent: string[] = [];
  const key = (principal: string, round: string) =>
    `daisy:round-notes:draft:${principal}:${round}:a`;
  for (const [principal, round] of [
    ['p', 'r1'],
    ['p', 'r2'],
    ['q', 'r2'],
  ] as const)
    storage.setItem(
      key(principal, round),
      JSON.stringify({
        recovery: newNoteCopy({
          generation: `${principal}-${round}`,
          html: 'REC',
          baseRevision: 1,
          now: 100,
        }),
      }),
    );
  const owner = (principalId: string, roundId: string) => ({
    principalId,
    sync: createDocumentSync({
      ...manualNoteResources(`${principalId}-${roundId}`, { storage }),

      api: documentApi(recordingSave(sent), () => [stored('a', 1)]),
      principalId,
      roundId,
      onConflict: () => {},
    }),
  });
  return { storage, sent, key, owner };
};

test('a Round-only owner replacement flushes pending text and preserves all same-principal recovery', async () => {
  const f = fixture(),
    previous = f.owner('p', 'r1'),
    next = f.owner('p', 'r2');
  await previous.sync.load();
  await next.sync.load();
  previous.sync.change('a', 'NEW');
  await releaseNoteOwner(previous, next);
  assert({
    given:
      'the actual cleanup receives another Round owner for the same principal',
    should:
      'flush and dispose the old owner without purging either Round recovery',
    actual: [
      f.sent,
      recoveryHtml(f.storage.getItem(f.key('p', 'r1'))),
      f.storage.getItem(f.key('p', 'r2')) !== null,
      previous.sync.available(),
      next.sync.available(),
    ],
    expected: [['NEW'], 'REC', true, false, true],
  });
});

test('account replacement purges the old principal and refuses late work without flushing it', async () => {
  const f = fixture(),
    previous = f.owner('p', 'r1'),
    next = f.owner('q', 'r2');
  await previous.sync.load();
  await next.sync.load();
  previous.sync.change('a', 'PRIVATE');
  await releaseNoteOwner(previous, next);
  previous.sync.change('a', 'LATE');
  await previous.sync.flush();
  assert({
    given: 'a replacement account and queued old-owner work',
    should:
      'purge the old principal across Rounds while retaining the new account and sending no old text',
    actual: [
      f.sent,
      f.storage.getItem(f.key('p', 'r1')),
      f.storage.getItem(f.key('p', 'r2')),
      f.storage.getItem(f.key('q', 'r2')) !== null,
      previous.sync.available(),
    ],
    expected: [[], null, null, true, false],
  });
});

test('Strict Mode reattachment retains the same live owner and its pending edit', async () => {
  const f = fixture(),
    previous = f.owner('p', 'r1');
  await previous.sync.load();
  previous.sync.change('a', 'NEW');
  await releaseNoteOwner(previous, { ...previous });
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
    previous = f.owner('p', 'r1');
  await previous.sync.load();
  previous.sync.change('a', 'NEW');
  await releaseNoteOwner(previous, previous);
  assert({
    given: 'the final token on ordinary unmount',
    should: 'drain the edit and retain explicit recovery for reopening',
    actual: [
      f.sent,
      previous.sync.available(),
      recoveryHtml(f.storage.getItem(f.key('p', 'r1'))),
    ],
    expected: [['NEW'], false, 'REC'],
  });
});
