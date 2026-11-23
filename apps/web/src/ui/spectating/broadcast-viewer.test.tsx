import type { SpectatorTimeline } from '@daisy/protocol/spectator-timeline';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  renderAccessible,
  type AccessibleView,
} from '../../test-support/rendered/accessible';
import { BroadcastViewer } from './broadcast-viewer';

setupRitewayBun();

const timeline = (over: Partial<SpectatorTimeline>): SpectatorTimeline => ({
  version: 1,
  roundId: 'abcdefghijklmnopqrstuvwx',
  mode: 'ranked',
  broadcast: { state: 'starting' },
  recording: 'none',
  resolution: null,
  sides: [],
  seats: [],
  stage: { kind: 'slate', moment: 'unreleased' },
  result: null,
  captions: [],
  releasedThrough: null,
  ...over,
});
const noop = () => undefined;
const router = {
  bfcacheId: 'test',
  back: noop,
  forward: noop,
  refresh: noop,
  push: noop,
  replace: noop,
  prefetch: noop,
};
const render = (over: Partial<SpectatorTimeline>, streamable = true) =>
  renderAccessible(
    h(
      AppRouterContext,
      { value: router },
      h(BroadcastViewer, {
        initial: timeline(over),
        visibility: 'public',
        stateUrl: 'https://feed.daisy.invalid/state/k.json',
        refreshHref: '/watch/r',
        streamable,
      }),
    ),
  );
const ended = { kind: 'ended' } as const;
/** Where every link on the page goes. */
const hrefs = (view: AccessibleView) =>
  view.all('link').map((link) => link.getAttribute('href'));

describe('BroadcastViewer', () => {
  test('with nothing published, the page says how to look again', () => {
    const noBroadcast = renderAccessible(
      h(
        AppRouterContext,
        { value: router },
        h(BroadcastViewer, {
          initial: timeline({ stage: { kind: 'upcoming' } }),
          visibility: 'public',
          stateUrl: null,
          refreshHref: '/watch/r',
          streamable: true,
        }),
      ),
    );
    const offered = noBroadcast.attribute('link', 'Refresh', 'href');
    const published = render({ stage: { kind: 'upcoming' } });
    assert({
      given: 'a Round with no state to read, and one with',
      should: 'offer a plain refresh to the first alone',
      actual: [offered, hrefs(published).includes('/watch/r')],
      expected: ['/watch/r', false],
    });
  });

  test('Stream this Round sits beside a playing Broadcast, and nowhere else', () => {
    const stream = {
      path: 'owned_hls',
      manifestUrl: 'https://feed.daisy.invalid/live/b/master.m3u8',
    } as const;
    const shown = (over: Partial<SpectatorTimeline>, streamable = true) =>
      render(over, streamable).has('region', 'Stream this Round');
    assert({
      given: 'on air with a floor, then stopped',
      should: 'offer the panel with the feed, then not',
      actual: [
        shown({ broadcast: { state: 'on_air', stream } }),
        render({ broadcast: { state: 'on_air', stream } })
          .within('region', 'Stream this Round')
          .attribute('textbox', 'Official feed URL', 'value'),
        shown({ broadcast: { state: 'stopped' } }),
      ],
      expected: [true, stream.manifestUrl, false],
    });
    assert({
      given:
        'a Youth Round on air whose youth debaters have not all released it (ADR 0161)',
      should: 'still play it, but offer no Stream this Round',
      actual: shown({ broadcast: { state: 'on_air', stream } }, false),
      expected: false,
    });
  });

  test('each state says what is so, with no player where nothing can play', () => {
    const cases: readonly (readonly [Partial<SpectatorTimeline>, string])[] = [
      [{ stage: { kind: 'upcoming' } }, 'This debate has not started'],
      [{}, 'The broadcast is starting'],
      [
        { broadcast: { state: 'interrupted', stream: null } },
        'The broadcast is interrupted',
      ],
      [{ broadcast: { state: 'stopped' } }, 'This broadcast was stopped'],
      [{ broadcast: { state: 'failed' } }, 'This broadcast could not be shown'],
      [{ broadcast: { state: 'none' } }, 'This debate is not being broadcast'],
      [
        {
          broadcast: { state: 'ended' },
          stage: ended,
          recording: 'processing',
        },
        'The recording is being prepared',
      ],
    ];
    for (const [over, text] of cases) {
      const view = render(over);
      assert({
        given: `the state showing "${text}"`,
        should: 'say it, with the facts beneath',
        actual: [
          view.textContent().includes(text),
          view.has('region', 'Round facts'),
        ],
        expected: [true, true],
      });
    }
  });

  test('a ready Recording is one link away', () => {
    const view = render({
      broadcast: { state: 'ended' },
      stage: ended,
      recording: 'ready',
    });
    assert({
      given: 'an ended Round with a ready Recording',
      should: 'link to it',
      actual: view.attribute('link', 'Watch the recording', 'href'),
      expected: '/recordings/abcdefghijklmnopqrstuvwx',
    });
  });

  test('on air', () => {
    const view = render({
      broadcast: {
        state: 'on_air',
        stream: {
          path: 'owned_hls',
          manifestUrl: 'https://feed.daisy.invalid/live/b/master.m3u8',
        },
      },
    });
    assert({
      given: 'a stream on air, rendered on the server',
      should: 'say the video is showing a slate',
      actual: view.text('status'),
      expected: 'The video is showing a slate. Nobody is speaking.',
    });
  });
});
