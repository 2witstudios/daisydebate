import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { reactionWindowOf, refuseAudienceReaction } from './handler';

setupRitewayBun();

const refusal = (facts: Parameters<typeof refuseAudienceReaction>[0]) => {
  try {
    refuseAudienceReaction(facts);
    return null;
  } catch (error) {
    return (error as { reason?: string }).reason;
  }
};

describe('refuseAudienceReaction', () => {
  test('a ban and a Broadcast that is not open each refuse', () => {
    assert({
      given: 'an open Broadcast, a ban, none at all, and a closed one',
      should: 'allow only the first',
      actual: [
        refusal({ broadcastOpen: true, banned: false, inLiveRoom: false }),
        refusal({ broadcastOpen: true, banned: true, inLiveRoom: false }),
        refusal({ broadcastOpen: null, banned: false, inLiveRoom: false }),
        refusal({ broadcastOpen: false, banned: false, inLiveRoom: false }),
      ],
      expected: [
        null,
        'reactions-banned',
        'reactions-unavailable',
        'reactions-closed',
      ],
    });
  });
});

describe('refuseAudienceReaction, in the live room', () => {
  test('anyone ahead of the feed takes no part while it is open', () => {
    assert({
      given: 'a place in the live room on an open Broadcast',
      should: 'refuse with its own fixed word',
      actual: refusal({ broadcastOpen: true, banned: false, inLiveRoom: true }),
      expected: 'reactions-live-room',
    });
  });
});

describe('reactionWindowOf', () => {
  test('two presses in ten seconds share a window', () => {
    assert({
      given: 'times inside and past one window',
      should: 'floor them to its start',
      actual: [
        reactionWindowOf('2026-11-02T12:00:01.000Z'),
        reactionWindowOf('2026-11-02T12:00:09.999Z'),
        reactionWindowOf('2026-11-02T12:00:10.000Z'),
      ],
      expected: [
        '2026-11-02T12:00:00.000Z',
        '2026-11-02T12:00:00.000Z',
        '2026-11-02T12:00:10.000Z',
      ],
    });
  });
});
