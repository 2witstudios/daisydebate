import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { watchViewer } from '../../../features/watch/debate-source';
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
  );
  if (screen.kind === 'watch') throw new Error('not a refusal');
  return renderToString(h(SpectateRefusal, { screen }));
};

describe('SpectateRefusal', () => {
  test('signed out sends the visitor to sign in and back', () => {
    const page = html('top-of-the-ladder', false);
    assert({
      given: 'an anonymous viewer at a public live debate',
      should: 'explain, tease the debate and link to sign-in with next',
      actual: [
        page.includes('Sign in to watch live debates'),
        page.includes('Top of the ladder'),
        page.includes('href="/sign-in?next=%2Fwatch%2Ftop-of-the-ladder"'),
        page.includes('open to everyone'),
      ],
      expected: [true, true, true, false],
    });
  });

  test('signed out at a private debate tells nothing about it', () => {
    const page = html('closed-door', false);
    assert({
      given: 'an anonymous viewer at a private debate',
      should: 'show no teaser',
      actual: [page.includes('Closed door'), page.includes('Sign in to watch')],
      expected: [false, true],
    });
  });

  test('private and missing read the same', () => {
    assert({
      given: 'a private debate and an unknown id',
      should: 'render identical pages',
      actual: html('closed-door') === html('no-such-debate'),
      expected: true,
    });
  });

  test('each other refusal', () => {
    assert({
      given:
        'a seated viewer, a removed one, a full audience, a debate not started',
      should: "show each one's heading and way out",
      actual: [
        html('your-own-debate').includes('You cannot spectate this debate'),
        html('your-own-debate').includes('href="/play"'),
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
