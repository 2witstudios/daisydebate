import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  decideFriendship,
  friendRelationOf,
  friendshipPolicy,
  type FriendshipFacts,
} from './friendship';

setupRitewayBun();

const me = 'a'.repeat(24);
const them = 'b'.repeat(24);
const facts = (overrides: Partial<FriendshipFacts> = {}): FriendshipFacts => ({
  actorId: me,
  otherActorId: them,
  pair: null,
  blocked: false,
  actorPendingOutgoing: 0,
  actorFriends: 0,
  otherFriends: 0,
  ...overrides,
});
const pendingFrom = (requesterActorId: string) =>
  ({ state: 'pending', requesterActorId }) as const;
const accepted = { state: 'accepted', requesterActorId: them } as const;

test('a request', () => {
  assert({
    given: 'no pair',
    should: 'open a pending request from the actor',
    actual: decideFriendship(facts(), 'request'),
    expected: { ok: true, next: pendingFrom(me), changed: true },
  });
  assert({
    given: 'the actor already asked',
    should: 'change nothing',
    actual: decideFriendship(facts({ pair: pendingFrom(me) }), 'request'),
    expected: { ok: true, next: pendingFrom(me), changed: false },
  });
  assert({
    given: 'the other member already asked the actor',
    should: 'converge on one accepted friendship',
    actual: decideFriendship(facts({ pair: pendingFrom(them) }), 'request'),
    expected: {
      ok: true,
      next: { state: 'accepted', requesterActorId: them },
      changed: true,
    },
  });
  assert({
    given: 'a friendship',
    should: 'change nothing',
    actual: decideFriendship(facts({ pair: accepted }), 'request'),
    expected: { ok: true, next: accepted, changed: false },
  });
});

test('refusals leave the pair unchanged', () => {
  assert({
    given: 'the actor names themself',
    should: 'refuse as self',
    actual: decideFriendship(facts({ otherActorId: me }), 'request'),
    expected: { ok: false, refusal: 'self' },
  });
  assert({
    given: 'a block on either side',
    should: 'refuse a request and an acceptance as unavailable',
    actual: [
      decideFriendship(facts({ blocked: true }), 'request'),
      decideFriendship(
        facts({ blocked: true, pair: pendingFrom(them) }),
        'accept',
      ),
    ],
    expected: [
      { ok: false, refusal: 'unavailable' },
      { ok: false, refusal: 'unavailable' },
    ],
  });
  assert({
    given: 'the actor holds the most outgoing requests',
    should: 'refuse a new request as a limit',
    actual: decideFriendship(
      facts({ actorPendingOutgoing: friendshipPolicy.maxPendingOutgoing }),
      'request',
    ),
    expected: { ok: false, refusal: 'limit' },
  });
  assert({
    given: 'either member at the friend limit',
    should: 'refuse the acceptance as a limit',
    actual: [
      decideFriendship(
        facts({
          pair: pendingFrom(them),
          actorFriends: friendshipPolicy.maxFriends,
        }),
        'accept',
      ),
      decideFriendship(
        facts({
          pair: pendingFrom(them),
          otherFriends: friendshipPolicy.maxFriends,
        }),
        'request',
      ),
    ],
    expected: [
      { ok: false, refusal: 'limit' },
      { ok: false, refusal: 'limit' },
    ],
  });
});

test('accept and decline answer only an incoming request', () => {
  assert({
    given: 'an incoming request',
    should: 'accept it, or decline it to no pair',
    actual: [
      decideFriendship(facts({ pair: pendingFrom(them) }), 'accept'),
      decideFriendship(facts({ pair: pendingFrom(them) }), 'decline'),
    ],
    expected: [
      {
        ok: true,
        next: { state: 'accepted', requesterActorId: them },
        changed: true,
      },
      { ok: true, next: null, changed: true },
    ],
  });
  assert({
    given: 'no request, or the actor’s own request',
    should: 'refuse as no request',
    actual: [
      decideFriendship(facts(), 'accept'),
      decideFriendship(facts({ pair: pendingFrom(me) }), 'accept'),
      decideFriendship(facts({ pair: pendingFrom(me) }), 'decline'),
    ],
    expected: [
      { ok: false, refusal: 'no-request' },
      { ok: false, refusal: 'no-request' },
      { ok: false, refusal: 'no-request' },
    ],
  });
  assert({
    given: 'a friendship already accepted, or a request already gone',
    should: 'treat the repeat answer as done',
    actual: [
      decideFriendship(facts({ pair: accepted }), 'accept'),
      decideFriendship(facts(), 'decline'),
    ],
    expected: [
      { ok: true, next: accepted, changed: false },
      { ok: true, next: null, changed: false },
    ],
  });
});

test('remove ends any pair, blocked or not', () => {
  assert({
    given: 'a friendship, an own request, a blocked pair and no pair',
    should: 'leave no pair each time',
    actual: [
      decideFriendship(facts({ pair: accepted }), 'remove'),
      decideFriendship(facts({ pair: pendingFrom(me) }), 'remove'),
      decideFriendship(facts({ pair: accepted, blocked: true }), 'remove'),
      decideFriendship(facts(), 'remove'),
    ],
    expected: [
      { ok: true, next: null, changed: true },
      { ok: true, next: null, changed: true },
      { ok: true, next: null, changed: true },
      { ok: true, next: null, changed: false },
    ],
  });
});

test('friendRelationOf', () => {
  assert({
    given: 'each pair state from the actor’s side',
    should: 'name the viewer’s relation',
    actual: [
      friendRelationOf(me, null),
      friendRelationOf(me, accepted),
      friendRelationOf(me, pendingFrom(me)),
      friendRelationOf(me, pendingFrom(them)),
    ],
    expected: ['none', 'friends', 'outgoing', 'incoming'],
  });
});
