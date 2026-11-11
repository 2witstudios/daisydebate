import type { AudienceState, SpectatorTimeline } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mountBrowserClient } from '../test-support/browser-client.test-support';
import type * as Client from './broadcast-viewer.test-support';

setupRitewayBun();

const roundId = 'abcdefghijklmnopqrstuvwx';
const timeline: SpectatorTimeline = {
  version: 1,
  roundId,
  mode: 'ranked',
  broadcast: { state: 'starting' },
  recording: 'none',
  resolution: null,
  seats: [],
  stage: { kind: 'slate', moment: 'unreleased' },
  result: null,
  captions: [],
  releasedThrough: null,
};
const published = (publishedAtMs: number): AudienceState => ({
  version: 1,
  publishedAtMs,
  timeline,
  audience: {
    version: 1,
    roundId,
    interaction: 'closed',
    messages: [],
    reactions: [],
    viewers: null,
  },
  pulseRate: 1,
});
const first = 'https://feed.daisy.invalid/state/first.json';
const second = 'https://feed.daisy.invalid/state/second.json';

/** The viewer in a private realm, its reads and its poll timers held by the test. */
const mount = async () => {
  const reads: string[] = [];
  const answers = new Map<string, () => Response>();
  const polls = new Map<object, () => void>();
  let refreshes = 0;
  const noop = () => undefined;
  const client = await mountBrowserClient<typeof Client>(
    Bun.resolveSync('./broadcast-viewer.test-support', import.meta.dir),
    {
      fetch: async (url: string) => {
        reads.push(url);
        return answers.get(url)!();
      },
      AbortSignal,
      // next/link reads build flags from the environment.
      process: { env: {} },
      URL,
      URLSearchParams,
      FormData,
      Headers,
      Request,
      Blob,
      location: new URL('https://daisy.test/'),
      Response,
      TextEncoder,
      TextDecoder,
      performance,
      crypto,
      // A poll waits seconds; everything React schedules runs at once.
      setTimeout: (run: () => void, ms = 0) => {
        if (ms < 1000) return setTimeout(run, ms);
        const handle = {};
        polls.set(handle, run);
        return handle;
      },
      clearTimeout: (handle: object | Parameters<typeof clearTimeout>[0]) => {
        if (
          typeof handle === 'object' &&
          handle !== null &&
          polls.delete(handle)
        )
          return;
        clearTimeout(handle as Parameters<typeof clearTimeout>[0]);
      },
    },
  );
  const router = {
    bfcacheId: 'test',
    back: noop,
    forward: noop,
    refresh: () => {
      refreshes += 1;
    },
    push: noop,
    replace: noop,
    prefetch: noop,
  };
  const show = (stateUrl: string) =>
    client.act(async () =>
      client.root.render(
        client.createElement(
          client.AppRouterContext,
          { value: router },
          client.createElement(
            client.BroadcastViewer,
            { initial: timeline, stateUrl, refreshHref: '/watch/r' },
            client.createElement('input', { id: 'beside' }),
          ),
        ),
      ),
    );
  /** Runs the one poll that is due and lets its read settle. */
  const poll = () =>
    client.act(async () => {
      const due = [...polls.values()];
      polls.clear();
      for (const run of due) run();
      for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
    });
  return {
    client,
    reads,
    answers,
    show,
    poll,
    refreshes: () => refreshes,
    /** What sits beside the player, as the audience chat does. */
    beside: () => client.container.querySelector('#beside'),
  };
};

test('a replaced link starts the page reading again', async () => {
  const viewer = await mount();
  try {
    viewer.answers.set(first, () => Response.json(published(1)));
    viewer.answers.set(second, () => Response.json(published(2)));
    await viewer.show(first);
    await viewer.poll();
    viewer.answers.set(first, () => new Response(null, { status: 404 }));
    await viewer.poll();
    const refreshed = viewer.refreshes();
    const beside = viewer.beside();
    // The server's fresh render names the replacement link.
    await viewer.show(second);
    await viewer.poll();
    assert({
      given:
        'a published state read, its address then gone, and a refresh that brings a new link',
      should:
        'ask the server once, then read the new address, keeping what sits beside the player',
      actual: {
        refreshed,
        reads: viewer.reads,
        kept: beside !== null && viewer.beside() === beside,
      },
      expected: { refreshed: 1, reads: [first, first, second], kept: true },
    });
  } finally {
    await viewer.client.act(async () => viewer.client.root.unmount());
  }
});

test('an address that comes back is read again without a new link', async () => {
  const viewer = await mount();
  try {
    viewer.answers.set(first, () => Response.json(published(1)));
    await viewer.show(first);
    await viewer.poll();
    viewer.answers.set(first, () => new Response(null, { status: 404 }));
    await viewer.poll();
    // The refresh answers with the same link: the page must keep looking.
    await viewer.show(first);
    await viewer.poll();
    const whileGone = viewer.refreshes();
    viewer.answers.set(first, () => Response.json(published(2)));
    await viewer.poll();
    assert({
      given:
        'an address gone for two reads on a link the server still names, then back',
      should:
        'keep reading it, ask the server again at the second missing read, and not once it is back',
      actual: {
        whileGone,
        refreshed: viewer.refreshes(),
        reads: viewer.reads.length,
      },
      expected: { whileGone: 2, refreshed: 2, reads: 4 },
    });
  } finally {
    await viewer.client.act(async () => viewer.client.root.unmount());
  }
});

test('a Round with nothing left to change is read no more', async () => {
  const viewer = await mount();
  try {
    const settled: AudienceState = {
      ...published(2),
      timeline: {
        ...timeline,
        broadcast: { state: 'ended' },
        stage: { kind: 'ended' },
        recording: 'none',
      },
    };
    viewer.answers.set(first, () => Response.json(published(1)));
    await viewer.show(first);
    await viewer.poll();
    viewer.answers.set(first, () => Response.json(settled));
    await viewer.poll();
    const whenSettled = viewer.reads.length;
    await viewer.poll();
    await viewer.poll();
    assert({
      given: 'a published state that says the Round ended with no Recording',
      should: 'show the end and stop reading',
      actual: {
        whenSettled,
        reads: viewer.reads.length,
        ended: (viewer.client.container.textContent ?? '').includes(
          'This debate has ended',
        ),
      },
      expected: { whenSettled: 2, reads: 2, ended: true },
    });
  } finally {
    await viewer.client.act(async () => viewer.client.root.unmount());
  }
});
