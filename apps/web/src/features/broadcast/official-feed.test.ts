import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { offeredFeedUrl, officialFeedUrl } from './official-feed';

setupRitewayBun();

const origin = 'https://public-bucket.t3.tigrisfiles.io';
const open = {
  broadcastId: 'b1',
  visibility: 'public',
  stoppedAt: null,
  completedAt: null,
} as const;
const at = new Date('2026-11-02T00:00:00.000Z');

describe('The official feed', () => {
  test('its URL is the public master playlist', () => {
    assert({
      given:
        'the public origin and a Broadcast, with and without a final slash',
      should: 'name the same master playlist',
      actual: [
        officialFeedUrl(origin, 'b1'),
        officialFeedUrl(`${origin}/`, 'b1'),
      ],
      expected: [
        `${origin}/live/b1/master.m3u8`,
        `${origin}/live/b1/master.m3u8`,
      ],
    });
  });

  test('an open public Broadcast is offered', () => {
    assert({
      given: 'an open Broadcast of a public Room',
      should: 'offer its feed',
      actual: offeredFeedUrl(origin, open),
      expected: `${origin}/live/b1/master.m3u8`,
    });
  });

  test('nothing is offered where there is no feed to stream', () => {
    const refused = [
      offeredFeedUrl(undefined, open),
      offeredFeedUrl(origin, null),
      offeredFeedUrl(origin, { ...open, visibility: 'private' }),
      offeredFeedUrl(origin, { ...open, stoppedAt: at }),
      offeredFeedUrl(origin, { ...open, completedAt: at }),
    ];
    assert({
      given:
        'no public origin, no Broadcast, a private Room, a stopped Broadcast and a finished one',
      should: 'offer none',
      actual: refused,
      expected: [null, null, null, null, null],
    });
  });

  test('an unlisted Broadcast never gets a guessable URL', () => {
    assert({
      given: 'an unlisted Room, whose keys have no unguessable prefix yet',
      should: 'offer none rather than a URL anyone could work out',
      actual: offeredFeedUrl(origin, { ...open, visibility: 'unlisted' }),
      expected: null,
    });
  });
});
