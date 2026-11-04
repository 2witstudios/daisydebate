import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  liveHref,
  replayHref,
  roomLinkReachesWatch,
  roomWatchHref,
} from './routes';

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

describe('a Room link and Watch', () => {
  test('reaches Watch only for a released Round', () => {
    assert({
      given: 'a released Round, and none',
      should: 'name the Watch page only for the released Round',
      actual: [roomWatchHref('round'), roomWatchHref(null)],
      expected: ['/watch/round', null],
    });
  });

  test('only the Room page itself skips the sign-in hint', () => {
    assert({
      given: 'the Room page and its neighbours',
      should: 'let the page decide for the Room alone',
      actual: ['/rooms/abc', '/rooms', '/rooms/abc/rematch', '/rounds/abc'].map(
        roomLinkReachesWatch,
      ),
      expected: [true, false, false, false],
    });
  });
});
