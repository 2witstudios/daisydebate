import { virtualClock } from '@daisy/clock/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { accessibleWithin } from '../../test-support/rendered/accessible';
import { mountBrowserClient } from '../test-support/browser-client.test-support';
import { virtualBrowserTime } from '../test-support/virtual-browser-time.test-support';
import type * as Client from './stage-room.test-support';

setupRitewayBun();

const prep = {
  phase: 'prep',
  remainingMs: 60_000,
  seats: [],
  debaterIdentities: [],
  nowMs: 0,
  room: null,
};
type Answer = (attempt: number) => Response | null | Promise<Response | null>;

/**
 * The stage page in a private browser realm on a virtual clock: its reads
 * are answered by the test, and what it says to Egress on the console is
 * recorded.
 */
const mount = async (answer: Answer) => {
  const clock = virtualClock();
  const time = virtualBrowserTime(clock);
  const said: string[] = [];
  const reads: string[] = [];
  const fetch = async (input: string, init?: RequestInit) => {
    reads.push(
      `${input} ${new Headers(init?.headers).get('x-stage-credential')}`,
    );
    const response = await answer(reads.length);
    if (response === null) throw new TypeError('no answer');
    return response;
  };
  const client = await mountBrowserClient<typeof Client>(
    Bun.resolveSync('./stage-room.test-support', import.meta.dir),
    (browser) => ({
      ...time.windowTimers,
      fetch,
      AbortSignal,
      TextEncoder,
      TextDecoder,
      Headers,
      Response,
      URL,
      URLSearchParams,
      navigator: browser.navigator,
      DOMException,
      EventTarget,
      Event: browser.Event,
      CustomEvent: browser.CustomEvent,
      crypto,
      location: browser.location,
      self: browser,
      globalThis: browser,
      getComputedStyle: browser.getComputedStyle.bind(browser),
      performance: { now: () => clock.nowMs() },
      console: { ...console, log: (line: string) => said.push(line) },
    }),
  );
  await client.act(async () =>
    client.root.render(
      client.createElement(client.StageRoom, {
        captureId: 'k'.repeat(24),
        credential: 'stage-secret',
      }),
    ),
  );
  return {
    ...client,
    said,
    reads,
    advance: (ms: number) => client.act(() => clock.advance(ms)),
    text: () =>
      accessibleWithin(client.container as unknown as Element).textContent(),
    close: async () => {
      await client.act(async () => client.root.unmount());
      await client.browser.happyDOM.abort();
    },
  };
};

describe('stage room', () => {
  test('a drawable stage shows, then asks Egress to record once', async () => {
    const stage = await mount(() => Response.json(prep));
    try {
      await stage.advance(0);
      const shown = stage.text();
      await stage.advance(5000);
      assert({
        given: 'a stage that reads a preparation snapshot every second',
        should:
          'read under its credential, draw the phase and say START_RECORDING once',
        actual: {
          drawn: shown.includes('Preparation'),
          firstRead: stage.reads[0],
          reads: stage.reads.length,
          said: stage.said,
        },
        expected: {
          drawn: true,
          firstRead: `/api/stage/${'k'.repeat(24)} stage-secret`,
          reads: 6,
          said: ['START_RECORDING'],
        },
      });
    } finally {
      await stage.close();
    }
  });

  test('the control plane ending the stage ends the recording', async () => {
    const stage = await mount((attempt) =>
      attempt < 3 ? Response.json(prep) : new Response(null, { status: 410 }),
    );
    try {
      await stage.advance(10_000);
      assert({
        given: 'a stage read answered 410 on its third second',
        should: 'say END_RECORDING once and read no more',
        actual: { said: stage.said, reads: stage.reads.length },
        expected: { said: ['START_RECORDING', 'END_RECORDING'], reads: 3 },
      });
    } finally {
      await stage.close();
    }
  });

  test('a web tier gone for ten seconds ends the recording', async () => {
    const stage = await mount((attempt) =>
      attempt === 1 ? Response.json(prep) : null,
    );
    try {
      await stage.advance(10_999);
      const before = [...stage.said];
      await stage.advance(1);
      await stage.advance(5000);
      assert({
        given: 'reads that stop answering after the first',
        should:
          'end once ten seconds of failures have passed, and stop reading',
        actual: { before, after: stage.said, reads: stage.reads.length },
        expected: {
          before: ['START_RECORDING'],
          after: ['START_RECORDING', 'END_RECORDING'],
          reads: 12,
        },
      });
    } finally {
      await stage.close();
    }
  });

  test('a blip passes', async () => {
    const stage = await mount((attempt) =>
      attempt % 3 === 0
        ? new Response(null, { status: 503 })
        : Response.json(prep),
    );
    try {
      await stage.advance(30_000);
      assert({
        given: 'one refused read in every three',
        should: 'keep recording',
        actual: stage.said,
        expected: ['START_RECORDING'],
      });
    } finally {
      await stage.close();
    }
  });

  test('a stage that ends before it is drawn never starts recording', async () => {
    const stage = await mount(() => new Response(null, { status: 410 }));
    try {
      await stage.advance(5000);
      assert({
        given: 'the first read answered 410',
        should: 'draw nothing and say only END_RECORDING',
        actual: {
          said: stage.said,
          text: stage.text(),
          reads: stage.reads.length,
        },
        expected: { said: ['END_RECORDING'], text: '', reads: 1 },
      });
    } finally {
      await stage.close();
    }
  });
});
