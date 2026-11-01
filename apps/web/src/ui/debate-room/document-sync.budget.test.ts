import { manualGenerations } from './document-sync.test-support';
import { createKeepaliveBudget } from './keepalive-budget';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createDocumentSync, type DocumentsApi } from './document-sync';
import { manualTimers, stored } from './document-sync.test-support';

setupRitewayBun();

const hugeHtml = (size: number) =>
  `<p>${'x'.repeat(Math.max(size - 13, 0))}</p>`;
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
    const sync = createDocumentSync({
      nextGeneration: manualGenerations('document-sync.budget.test:1'),
      budget: createKeepaliveBudget(),
      wallClock: () => 100,
      api,
      roundId: 'r',
      principalId: 'p1',
      onConflict: () => {},
      timers: manualTimers().timers,
      storage: null,
    });
    await sync.load();
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
