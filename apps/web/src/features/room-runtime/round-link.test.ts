import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { roundLinkOf } from './round-link';

setupRitewayBun();

const round = { id: 'r'.repeat(24), status: 'active' } as const;
const view = {
  roundRef: round,
  hostActorId: 'host',
  participants: [{ actorId: 'seat' }],
  visibility: 'public',
} as unknown as Parameters<typeof roundLinkOf>[0];

describe('roundLinkOf', () => {
  test('each reader reaches a page that serves them', () => {
    assert({
      given: 'a Room with no Round yet',
      should: 'offer no link',
      actual: roundLinkOf({ ...view, roundRef: null }, 'seat'),
      expected: null,
    });
    assert({
      given: 'a seat, the host and a member with neither, on a public Room',
      should: 'keep the first two on the Round and send the third to watch it',
      actual: [
        roundLinkOf(view, 'seat'),
        roundLinkOf(view, 'host'),
        roundLinkOf(view, 'member'),
      ],
      expected: [
        `/rounds/${round.id}`,
        `/rounds/${round.id}`,
        `/watch/${round.id}`,
      ],
    });
    assert({
      given: 'a member reading a Room that is not public',
      should: 'not send them to a public page that refuses them',
      actual: roundLinkOf({ ...view, visibility: 'unlisted' }, 'member'),
      expected: `/rounds/${round.id}`,
    });
  });
});
