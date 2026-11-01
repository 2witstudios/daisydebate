import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createDocumentSync, type DocumentsApi } from './document-sync';
import { manualTimers, stored } from './document-sync.test-support';

setupRitewayBun();

const htmlOf = (size: number) =>
  `<p>${'x'.repeat(Math.max(size - 13, 0))}</p>`;
const bytes = (id: string, html: string, expectedRevision: number) =>
  new TextEncoder().encode(JSON.stringify({ id, html, expectedRevision }))
    .length + 64;

describe('keepalive exit budget', () => {
  test('reserves bytes across overlapping flushes, not just per call', async () => {
    let settle: (() => void) | null = null;
    const first = new Promise<void>((resolve) => {
      settle = resolve;
    });
    let setttled = false;
    const sent: { id: string; html: string; expectedRevision: number }[] = [];
    const api: DocumentsApi = {
      list: async () => [stored('a', 1), stored('b', 1)],
      create: async () => stored('new'),
      save: async (input) => {
        sent.push(input);
        await first;
        setttled = true;
        return { status: 'saved', revision: input.expectedRevision + 1 };
      },
    };
    const sync = createDocumentSync({
      api,
      roundId: 'r',
      principalId: 'p1',
      onConflict: () => {},
      timers: manualTimers().timers,
      storage: null,
    });
    await sync.load();
    sync.change('a', htmlOf(26_000));
    sync.change('b', htmlOf(60_000));
    // The first flush reserves A's bytes while its send is outstanding.
    const flushing = sync.flushKeepalive();
    // The second flush, still against the same outstanding reservation,
    // must not admit B's larger body over the shared budget.
    const second = sync.flushKeepalive();
    settle?.();
    await Promise.all([flushing, second]);
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
