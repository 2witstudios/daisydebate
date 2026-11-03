import type { SpectatorTimeline } from '@daisy/protocol';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { BroadcastViewer } from './broadcast-viewer';

setupRitewayBun();

const timeline = (over: Partial<SpectatorTimeline>): SpectatorTimeline => ({
  version: 1,
  roundId: 'abcdefghijklmnopqrstuvwx',
  mode: 'ranked',
  broadcast: { state: 'starting' },
  recording: 'none',
  resolution: null,
  seats: [],
  stage: { kind: 'slate', moment: 'between_speeches' },
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
const render = (over: Partial<SpectatorTimeline>) =>
  renderToString(
    h(
      AppRouterContext,
      { value: router },
      h(BroadcastViewer, { initial: timeline(over) }),
    ),
  );
const ended = { kind: 'ended' } as const;

describe('BroadcastViewer', () => {
  test('Stream this Round sits beside a playing Broadcast, and nowhere else', () => {
    const stream = {
      path: 'owned_hls',
      manifestUrl: 'https://feed.daisy.invalid/live/b/master.m3u8',
    } as const;
    const shown = (over: Partial<SpectatorTimeline>) =>
      render(over).includes('Stream this Round');
    assert({
      given: 'on air with a floor, then stopped',
      should: 'offer the panel with the feed, then not',
      actual: [
        shown({ broadcast: { state: 'on_air', stream } }),
        render({ broadcast: { state: 'on_air', stream } }).includes(
          stream.manifestUrl,
        ),
        shown({ broadcast: { state: 'stopped' } }),
      ],
      expected: [true, true, false],
    });
  });

  test('each state says what is so, with no player where nothing can play', () => {
    const cases: readonly (readonly [Partial<SpectatorTimeline>, string])[] = [
      [{ stage: { kind: 'upcoming' } }, 'This debate has not started'],
      [{}, 'The broadcast is starting'],
      [
        { broadcast: { state: 'held', releasesAt: null } },
        'It is released when the debate ends.',
      ],
      [
        {
          broadcast: {
            state: 'held',
            releasesAt: '2026-11-03T12:00:00.000Z',
          },
        },
        '12:00:00 GMT',
      ],
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
      const html = render(over);
      assert({
        given: `the state showing "${text}"`,
        should: 'say it, with no video and the facts beneath',
        actual: [
          html.includes(text),
          html.includes('<video'),
          html.includes('Round facts'),
        ],
        expected: [true, false, true],
      });
    }
  });

  test('a ready Recording is one link away, with no script', () => {
    const html = render({
      broadcast: { state: 'ended' },
      stage: ended,
      recording: 'ready',
    });
    assert({
      given: 'an ended Round with a ready Recording',
      should: 'link to it',
      actual: html.includes('href="/recordings/abcdefghijklmnopqrstuvwx"'),
      expected: true,
    });
  });

  test('on air', () => {
    const html = render({
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
      should: 'give a labelled video with controls, and a no-script note',
      actual: [
        html.includes('aria-label="Broadcast of this debate"'),
        html.includes('controls'),
        html.includes('The video needs JavaScript'),
        html.includes('The video is showing a slate. Nobody is speaking.'),
      ],
      expected: [true, true, true, true],
    });
  });
});
