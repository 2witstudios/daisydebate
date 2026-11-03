import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { audienceLinkHash } from '../audience-link/audience-link';
import { newFeedKey, offeredFeedUrl, officialFeedUrl } from './official-feed';

setupRitewayBun();

const origin = 'https://public-bucket.t3.tigrisfiles.io';
const open = {
  feedKey: 'b1',
  visibility: 'public',
  audienceLinkHash: null,
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
      actual: offeredFeedUrl(origin, open, null),
      expected: `${origin}/live/b1/master.m3u8`,
    });
  });

  test('nothing is offered where there is no feed to stream', () => {
    const refused = [
      offeredFeedUrl(undefined, open, null),
      offeredFeedUrl(origin, null, null),
      offeredFeedUrl(origin, { ...open, visibility: 'private' }, null),
      offeredFeedUrl(origin, { ...open, stoppedAt: at }, null),
      offeredFeedUrl(origin, { ...open, completedAt: at }, null),
    ];
    assert({
      given:
        'no public origin, no Broadcast, a private Room, a stopped Broadcast and a finished one',
      should: 'offer none',
      actual: refused,
      expected: [null, null, null, null, null],
    });
  });

  test('an unlisted Broadcast is offered only past its current link', () => {
    const link = audienceLinkHash('the-link');
    const unlisted = {
      ...open,
      feedKey: 'random-key',
      visibility: 'unlisted',
      audienceLinkHash: link,
    } as const;
    assert({
      given: 'no link, then a wrong one, then the current one',
      should: 'offer its random address to the current link alone',
      actual: [
        offeredFeedUrl(origin, unlisted, null),
        offeredFeedUrl(origin, unlisted, audienceLinkHash('old')),
        offeredFeedUrl(origin, unlisted, link),
      ],
      expected: [null, null, `${origin}/live/random-key/master.m3u8`],
    });
  });

  test('the key is 256 bits of the injected entropy', () => {
    assert({
      given: '32 random bytes',
      should: 'encode them all for an object key',
      actual: newFeedKey((bytes) => new Uint8Array(bytes).fill(1)),
      expected: Buffer.from(new Uint8Array(32).fill(1)).toString('base64url'),
    });
    assert({
      given: 'the default entropy, twice',
      should: 'never repeat',
      actual: newFeedKey() === newFeedKey(),
      expected: false,
    });
  });
});
