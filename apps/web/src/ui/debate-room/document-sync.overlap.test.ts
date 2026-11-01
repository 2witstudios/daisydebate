import {
  overlappingNoteExit,
  loadNoteSync,
  documentApi,
  noteHtml as htmlOf,
  manualNoteResources,
  stored,
} from './document-sync.test-support';

import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { type DocumentsApi } from './document-sync';

setupRitewayBun();

const bytes = (id: string, html: string, expectedRevision: number) =>
  new TextEncoder().encode(JSON.stringify({ id, html, expectedRevision }))
    .length + 64;

describe('keepalive exit budget', () => {
  test('reserves bytes across overlapping flushes, not just per call', async () => {
    const settle: { resolve: () => void } = { resolve: () => {} };
    const first = new Promise<void>((resolve) => {
      settle.resolve = resolve;
    });
    let setttled = false;
    const sent: { id: string; html: string; expectedRevision: number }[] = [];
    const api: DocumentsApi = documentApi(
      async (input) => {
        sent.push(input);
        await first;
        setttled = true;
        return { status: 'saved', revision: input.expectedRevision + 1 };
      },
      () => [stored('a', 1), stored('b', 1)],
    );
    const sync = await loadNoteSync({
      ...manualNoteResources('document-sync.overlap.test:1'),

      api,
      roundId: 'r',
      principalId: 'p1',
      onConflict: () => {},
    });

    await overlappingNoteExit(sync, settle.resolve);
    const reservedTotal = sent.reduce(
      (total, one) => total + bytes(one.id, one.html, one.expectedRevision),
      0,
    );
    assert({
      given:
        'A made into a 26 KiB recovery, then B typed while A was in flight',
      should: 'not send the two bodies whose sum exceeds 64 KiB',
      actual: reservedTotal,
      expected: bytes('a', htmlOf(26_000), 1),
    });
    assert({
      given: 'the parses above',
      should: 'not let the wait end before the server answers',
      actual: setttled,
      expected: true,
    });
  });
});
