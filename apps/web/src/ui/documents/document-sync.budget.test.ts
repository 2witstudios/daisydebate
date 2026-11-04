import { listed } from './document-sync.test-support';
import {
  loadDraftSync,
  draftHtml as hugeHtml,
  manualDraftResources,
  manualTimers,
  stored,
} from './document-sync.test-support';

import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { type DocumentsApi } from './document-sync';

setupRitewayBun();

const apiWith = (
  save: DocumentsApi['save'],
  documents: readonly string[] = ['a', 'b'] as const,
): DocumentsApi => ({
  ...listed(() => documents.map((id) => stored(id, 1))),
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
    const sync = await loadDraftSync({
      ...manualDraftResources('document-sync.budget.test:1'),

      api,
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

  test('resumes an over-budget exit edit when the page survives its pagehide', async () => {
    const sentHtml: { html: string; keepalive: boolean }[] = [];
    const clock = manualTimers();
    const sync = await loadDraftSync({
      ...manualDraftResources('document-sync.budget.test:2', {
        timers: clock.timers,
      }),
      api: apiWith(async ({ html, keepalive, expectedRevision }) => {
        sentHtml.push({ html, keepalive: keepalive === true });
        return { status: 'saved', revision: expectedRevision + 1 };
      }),
      principalId: 'p1',
      onConflict: () => {},
    });

    const expectedHtml = hugeHtml(70 * 1024);
    sync.change('a', expectedHtml);
    await sync.flushKeepalive();
    const atExit = sentHtml.length;
    // A page restored from the back/forward cache resumes its frozen timers.
    clock.fire();
    assert({
      given: 'an edit over the exit budget on a page that keeps running',
      should: 'send nothing at exit, then save it through an ordinary request',
      actual: [atExit, sentHtml],
      expected: [0, [{ html: expectedHtml, keepalive: false }]],
    });
  });
});
