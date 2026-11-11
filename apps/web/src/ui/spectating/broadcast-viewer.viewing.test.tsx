import type { BroadcastStream, SpectatorTimeline } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mountBrowserClient } from '../test-support/browser-client.test-support';
import type * as Client from './broadcast-viewer.test-support';

setupRitewayBun();

const streamOf = (name: string): BroadcastStream => ({
  path: 'owned_hls',
  manifestUrl: `https://feed.daisy.invalid/live/${name}/master.m3u8`,
});
const onAir = (stream: BroadcastStream): SpectatorTimeline => ({
  version: 1,
  roundId: 'abcdefghijklmnopqrstuvwx',
  mode: 'ranked',
  broadcast: { state: 'on_air', stream },
  recording: 'none',
  resolution: null,
  seats: [],
  stage: { kind: 'slate', moment: 'unreleased' },
  result: null,
  captions: [],
  releasedThrough: null,
});
const UNPLAYABLE = 'The video could not be played';

/**
 * The viewer in a private realm whose browser has no way to play HLS until
 * the test gives it one, so the first player gives up as it mounts.
 */
const mount = async () => {
  const noop = () => undefined;
  const client = await mountBrowserClient<typeof Client>(
    Bun.resolveSync('./broadcast-viewer.test-support', import.meta.dir),
    {
      // next/link reads build flags from the environment.
      process: { env: {} },
      URL,
      URLSearchParams,
      FormData,
      Headers,
      Request,
      Response,
      Blob,
      AbortSignal,
      TextEncoder,
      TextDecoder,
      fetch: () => Promise.reject(new Error('this page reads nothing')),
      location: new URL('https://daisy.test/'),
      performance,
      crypto,
    },
  );
  const router = {
    bfcacheId: 'test',
    back: noop,
    forward: noop,
    refresh: noop,
    push: noop,
    replace: noop,
    prefetch: noop,
  };
  const video = client.browser.HTMLVideoElement.prototype as unknown as {
    canPlayType: () => string;
    play: () => Promise<void>;
    load: () => void;
  };
  video.canPlayType = () => '';
  video.play = () => Promise.resolve();
  video.load = noop;
  return {
    client,
    /** The server's render of the page, with no published state to read. */
    show: (initial: SpectatorTimeline) =>
      client.act(async () =>
        client.root.render(
          client.createElement(
            client.AppRouterContext,
            { value: router },
            client.createElement(client.BroadcastViewer, {
              initial,
              stateUrl: null,
              refreshHref: '/watch/r',
            }),
          ),
        ),
      ),
    /** From now on this browser plays HLS itself. */
    playsHls: () => {
      video.canPlayType = () => 'maybe';
    },
    retry: () =>
      client.act(async () => {
        client.container
          .querySelector('button')
          ?.dispatchEvent(
            new client.browser.MouseEvent('click', { bubbles: true }),
          );
      }),
    saysUnplayable: () =>
      (client.container.textContent ?? '').includes(UNPLAYABLE),
    hasVideo: () => client.container.querySelector('video') !== null,
  };
};

test('a player that gives up as it mounts is told apart from the next stream', async () => {
  const viewer = await mount();
  try {
    await viewer.show(onAir(streamOf('a')));
    const first = {
      unplayable: viewer.saysUnplayable(),
      video: viewer.hasVideo(),
    };
    viewer.playsHls();
    await viewer.show(onAir(streamOf('b')));
    assert({
      given:
        'a stream this browser could not play, then a different stream it can',
      should: 'say the first could not be played, then play the second',
      actual: {
        first,
        second: {
          unplayable: viewer.saysUnplayable(),
          video: viewer.hasVideo(),
        },
      },
      expected: {
        first: { unplayable: true, video: false },
        second: { unplayable: false, video: true },
      },
    });
  } finally {
    await viewer.client.act(async () => viewer.client.root.unmount());
  }
});

test('Try again gives the same stream a new player', async () => {
  const viewer = await mount();
  try {
    await viewer.show(onAir(streamOf('a')));
    viewer.playsHls();
    await viewer.retry();
    assert({
      given: 'a stream that could not be played, and Try again once it can',
      should: 'play it',
      actual: { unplayable: viewer.saysUnplayable(), video: viewer.hasVideo() },
      expected: { unplayable: false, video: true },
    });
  } finally {
    await viewer.client.act(async () => viewer.client.root.unmount());
  }
});
