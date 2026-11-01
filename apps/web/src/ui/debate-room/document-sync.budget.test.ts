import {
  loadNoteSync,
  noteHtml as hugeHtml,
  manualNoteResources,
  stored,
} from './document-sync.test-support';

import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { type DocumentsApi } from './document-sync';

setupRitewayBun();

const apiWith = (
  save: DocumentsApi['save'],
  documents: readonly string[] = ['a', 'b'] as const,
): DocumentsApi => ({
  list: async () => documents.map((id) => stored(id, 1)),
  create: async () => stored('new'),
  save,
});

describe('document sync keepalive budget', () => {
  test('keeps out-of-budget edits recoverable rather than silently unsent', async () => {
    const sentHtml: string[] = [];
    const api = apiWith(async (input) => {
      sentHtml.push(input.html);
      return { status: 'saved', revision: input.expectedRevision + 1 };
    });
    const sync = await loadNoteSync({
      ...manualNoteResources('document-sync.budget.test:1'),

      api,
      roundId: 'r',
      principalId: 'p1',
      onConflict: () => {},
    });

    const expectedHtml = hugeHtml(70 * 1024);
    sync.change('a', expectedHtml);
    await sync.flush();
    assert({
      given: 'a 70 KiB edit on the ordinary flush',
      should: 'send the whole document, exactly once',
      actual: [sentHtml, sentHtml.length],
      expected: [[expectedHtml], 1],
    });
  });
});
