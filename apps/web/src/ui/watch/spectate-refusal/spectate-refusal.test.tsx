import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  sampleWatchSource,
  watchViewer,
} from '../../../features/watch/sample-source.test-support';
import {
  openSpectate,
  type SpectateScreen,
} from '../../../features/watch/open-spectate';
import { defaultSpectateQuery } from '../../../features/watch/spectate-query';
import { SpectateRefusal } from './spectate-refusal';

setupRitewayBun();

const html = (id: string, signedIn = true): string => {
  const screen: SpectateScreen = openSpectate(
    id,
    watchViewer(signedIn),
    defaultSpectateQuery,
    sampleWatchSource,
  );
  if (screen.kind === 'watch') throw new Error('not a refusal');
  return renderToString(h(SpectateRefusal, { screen }));
};

describe('SpectateRefusal', () => {
  test('private and missing read the same', () => {
    assert({
      given: 'a private Round and an unknown id',
      should: 'render identical pages',
      actual: html('closed-door') === html('no-such-round'),
      expected: true,
    });
  });

  test('each other refusal', () => {
    assert({
      given:
        'a seated viewer, a removed one, a full audience, a Round not started',
      should: "show each one's heading and way out",
      actual: [
        html('your-own-round').includes('You cannot spectate this debate'),
        html('your-own-round').includes('href="/rooms/started"'),
        html('host-restricted').includes('You can no longer watch this debate'),
        html('packed-house').includes('This debate is full of spectators'),
        html('starting-soon').includes('This debate has not started'),
        html('starting-soon').includes('Seating up'),
        html('starting-soon').includes('Ready'),
        html('packed-house').includes('href="/watch"'),
      ],
      expected: [true, true, true, true, true, true, true, true],
    });
  });
});
