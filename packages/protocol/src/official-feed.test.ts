import { assert, setupRitewayBun, test } from 'riteway/bun';
import { broadcastLivePrefix, officialFeedPath } from './official-feed';

setupRitewayBun();

test('the official feed is the Broadcast’s public master playlist', () => {
  assert({
    given: 'a Broadcast id',
    should: 'name its public tree and the master playlist inside it',
    actual: [broadcastLivePrefix('b1'), officialFeedPath('b1')],
    expected: ['live/b1/', 'live/b1/master.m3u8'],
  });
});
