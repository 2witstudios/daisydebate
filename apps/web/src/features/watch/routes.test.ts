import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { liveHref, replayHref, signInToWatchHref } from './routes';

setupRitewayBun();

describe('watch routes', () => {
  test('live and replay hrefs', () => {
    assert({
      given: 'a debate id with and without a query',
      should: 'put live under /watch and replay under /recordings',
      actual: [
        liveHref('top'),
        liveHref('top', 'pane=chat'),
        replayHref('top'),
        replayHref('top', 't=90'),
      ],
      expected: [
        '/watch/top',
        '/watch/top?pane=chat',
        '/recordings/top',
        '/recordings/top?t=90',
      ],
    });
  });

  test('ids are encoded, never trusted as path', () => {
    assert({
      given: 'an id with a slash and a space',
      should: 'encode it into one segment',
      actual: liveHref('a/b c'),
      expected: '/watch/a%2Fb%20c',
    });
  });

  test('signing in returns to the live view', () => {
    assert({
      given: 'a debate id',
      should: 'sign in with that live view as the next destination',
      actual: signInToWatchHref('top'),
      expected: '/sign-in?next=%2Fwatch%2Ftop',
    });
  });
});
