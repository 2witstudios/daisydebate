import type { FriendRelation, FriendshipState } from '@daisy/protocol';

/**
 * Friendship between two members (ADR 0071): one unordered pair, asked by
 * one member and accepted by the other. Declining or removing deletes the
 * pair, so a pair is either pending or accepted. A block on either side
 * (messaging's contact pair, ADR 0061) refuses every new request and
 * acceptance; removing always works.
 */
export const friendshipPolicy = {
  maxFriends: 250,
  maxPendingOutgoing: 20,
} as const;

export type FriendshipPair = {
  readonly state: FriendshipState;
  readonly requesterActorId: string;
};

/** Read under the pair's locks; every count is the locked current value. */
export type FriendshipFacts = {
  readonly actorId: string;
  readonly otherActorId: string;
  readonly pair: FriendshipPair | null;
  readonly blocked: boolean;
  readonly actorPendingOutgoing: number;
  readonly actorFriends: number;
  readonly otherFriends: number;
};

export type FriendshipCommand = 'request' | 'accept' | 'decline' | 'remove';

/** `unavailable` never says whether a block or the member is the reason. */
export type FriendshipRefusal = 'self' | 'unavailable' | 'limit' | 'no-request';

export type FriendshipDecision =
  | {
      readonly ok: true;
      readonly next: FriendshipPair | null;
      readonly changed: boolean;
    }
  | { readonly ok: false; readonly refusal: FriendshipRefusal };

const refuse = (refusal: FriendshipRefusal): FriendshipDecision => ({
  ok: false,
  refusal,
});
const keep = (pair: FriendshipPair | null): FriendshipDecision => ({
  ok: true,
  next: pair,
  changed: false,
});
const become = (pair: FriendshipPair | null): FriendshipDecision => ({
  ok: true,
  next: pair,
  changed: true,
});

const atFriendLimit = (facts: FriendshipFacts) =>
  facts.actorFriends >= friendshipPolicy.maxFriends ||
  facts.otherFriends >= friendshipPolicy.maxFriends;

function acceptIncoming(
  facts: FriendshipFacts,
  pair: FriendshipPair,
): FriendshipDecision {
  if (facts.blocked) return refuse('unavailable');
  if (atFriendLimit(facts)) return refuse('limit');
  return become({ state: 'accepted', requesterActorId: pair.requesterActorId });
}

const incomingOf = (facts: FriendshipFacts): FriendshipPair | null =>
  facts.pair?.state === 'pending' &&
  facts.pair.requesterActorId !== facts.actorId
    ? facts.pair
    : null;

function decideRequest(facts: FriendshipFacts): FriendshipDecision {
  const { pair } = facts;
  if (pair?.state === 'accepted') return keep(pair);
  const incoming = incomingOf(facts);
  if (incoming) return acceptIncoming(facts, incoming);
  if (pair) return keep(pair);
  if (facts.blocked) return refuse('unavailable');
  if (facts.actorPendingOutgoing >= friendshipPolicy.maxPendingOutgoing)
    return refuse('limit');
  return become({ state: 'pending', requesterActorId: facts.actorId });
}

function decideAccept(facts: FriendshipFacts): FriendshipDecision {
  if (facts.pair?.state === 'accepted') return keep(facts.pair);
  const incoming = incomingOf(facts);
  return incoming ? acceptIncoming(facts, incoming) : refuse('no-request');
}

function decideDecline(facts: FriendshipFacts): FriendshipDecision {
  if (!facts.pair) return keep(null);
  return incomingOf(facts) ? become(null) : refuse('no-request');
}

const decisions: Readonly<
  Record<FriendshipCommand, (facts: FriendshipFacts) => FriendshipDecision>
> = {
  request: decideRequest,
  accept: decideAccept,
  decline: decideDecline,
  remove: (facts) => (facts.pair ? become(null) : keep(null)),
};

export function decideFriendship(
  facts: FriendshipFacts,
  command: FriendshipCommand,
): FriendshipDecision {
  if (facts.actorId === facts.otherActorId) return refuse('self');
  return decisions[command](facts);
}

/** The viewer's relation to the other member of a pair. */
export function friendRelationOf(
  viewerActorId: string,
  pair: FriendshipPair | null,
): FriendRelation {
  if (!pair) return 'none';
  if (pair.state === 'accepted') return 'friends';
  return pair.requesterActorId === viewerActorId ? 'outgoing' : 'incoming';
}
