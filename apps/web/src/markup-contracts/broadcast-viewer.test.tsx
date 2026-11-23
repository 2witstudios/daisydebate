import type { SpectatorTimeline } from '@daisy/protocol/spectator-timeline';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { BroadcastViewer } from '../ui/spectating/broadcast-viewer';

setupRitewayBun();

/**
 * The player is a native `<video>`, which has no ARIA role, so whether the
 * page plays, and the player's label and controls, cannot be asked for by
 * role and name.
 */
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
  renderMarkup(
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
const stream = {
  path: 'owned_hls',
  manifestUrl: 'https://feed.daisy.invalid/live/b/master.m3u8',
} as const;
const ended = { kind: 'ended' } as const;

describe('BroadcastViewer markup', () => {
  test('a Youth Round on air past the reuse fence still plays (ADR 0161)', () => {
    assert({
      given:
        'a Youth Round on air whose youth debaters have not all released it',
      should: 'still play it',
      actual: render(
        { broadcast: { state: 'on_air', stream } },
        false,
      ).includes('<video'),
      expected: true,
    });
  });

  test('no player where nothing can play', () => {
    const states: readonly Partial<SpectatorTimeline>[] = [
      { stage: { kind: 'upcoming' } },
      {},
      { broadcast: { state: 'interrupted', stream: null } },
      { broadcast: { state: 'stopped' } },
      { broadcast: { state: 'failed' } },
      { broadcast: { state: 'none' } },
      { broadcast: { state: 'ended' }, stage: ended, recording: 'processing' },
    ];
    assert({
      given: 'each state that replaces the player',
      should: 'render no video',
      actual: states.map((over) => render(over).includes('<video')),
      expected: states.map(() => false),
    });
  });

  test('on air', () => {
    const video =
      render({ broadcast: { state: 'on_air', stream } }).match(
        /<video [^>]*>/,
      )?.[0] ?? '';
    assert({
      given: 'a stream on air, rendered on the server',
      should: 'give a labelled video with controls',
      actual: [
        video.includes('aria-label="Broadcast of this debate"'),
        /\scontrols(?:=""|\s|>)/.test(video),
      ],
      expected: [true, true],
    });
  });
});
