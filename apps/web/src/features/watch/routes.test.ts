import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { liveHref, replayHref } from './routes';

setupRitewayBun();

describe('watch routes', () => {
  test('live and replay hrefs', () => {
    assert({
      given: 'a Round id, and a replay with a query',
      should: 'put live under /watch and replay under /recordings',
      actual: [liveHref('top'), replayHref('top'), replayHref('top', 't=90')],
      expected: ['/watch/top', '/recordings/top', '/recordings/top?t=90'],
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
});
