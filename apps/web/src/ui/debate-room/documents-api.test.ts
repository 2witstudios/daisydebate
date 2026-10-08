import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createDocumentSync, type Timers } from './document-sync';
import { createDocumentsApi } from './documents-api';

setupRitewayBun();

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });

/** Timers that never fire on their own: retries wait for the test. */
const idleTimers: Timers = { set: () => 0, clear: () => {} };

/**
 * A server whose first save never answers until its request is aborted,
 * as fetch rejects when its signal aborts.
 */
const stallingServer = () => {
  const sent: string[] = [];
  let arrived = () => {};
  /** Settles once the first save reaches the server. */
  const stalled = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const send = async (path: string, init: RequestInit) => {
    if (path.endsWith('/list'))
      return json({ documents: [{ id: 'a', revision: 1 }] });
    sent.push((JSON.parse(String(init.body)) as { html: string }).html);
    if (sent.length > 1) return json({ revision: sent.length + 1 });
    arrived();
    return new Promise<Response>((_, reject) => {
      const timedOut = () =>
        reject(new DOMException('The operation timed out.', 'TimeoutError'));
      if (init.signal?.aborted) timedOut();
      init.signal?.addEventListener('abort', timedOut);
    });
  };
  return { send, sent, stalled };
};

describe('createDocumentsApi', () => {
  test('a stalled save', async () => {
    const { send, sent, stalled } = stallingServer();
    const timeout = new AbortController();
    const failures: number[] = [];
    const sync = createDocumentSync({
      api: createDocumentsApi({ send, signal: () => timeout.signal }),
      roundId: 'd',
      onConflict: () => {},
      onSaveFailed: (_, attempts) => failures.push(attempts),
      timers: idleTimers,
    });
    await sync.load();
    sync.change('a', '<p>1</p>');
    const first = sync.flush();
    await stalled;
    sync.change('a', '<p>12</p>');
    const second = sync.flush();
    timeout.abort();
    await Promise.all([first, second]);
    assert({
      given: 'a save the server never answers, then a later edit',
      should:
        'fail the stalled save once its request times out and send the later edit',
      actual: { sent, failures },
      expected: { sent: ['<p>1</p>', '<p>12</p>'], failures: [1] },
    });
  });

  test('request timeout', async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    const api = createDocumentsApi({
      send: async (_path, init) => {
        signals.push(init.signal);
        return json({ documents: [] });
      },
    });
    await api.list('d');
    assert({
      given: 'a document request with the default signal',
      should: 'carry an abort signal that bounds the request',
      actual: signals[0] instanceof AbortSignal && !signals[0].aborted,
      expected: true,
    });
  });
});
