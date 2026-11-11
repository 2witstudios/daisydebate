import type { ChallengeList } from '@daisy/protocol';

type Offer = ChallengeList['outgoing'][number];

/**
 * An offer this member sent, as their tab holds it. `cancelling`: the member
 * is ending it, so its end needs no notice. `ended`: it left the list without
 * the member ending it or anyone accepting, and says so until dismissed.
 */
type SentOffer = {
  readonly standing: 'waiting' | 'cancelling' | 'ended';
  readonly offer: Offer;
};

/** A member's challenges as one tab holds them between reads (ADR 0103). */
export type ChallengesHeld = {
  readonly incoming: ChallengeList['incoming'];
  readonly accepted: ChallengeList['accepted'];
  /** Each offer once: those still standing in the list's order, then those ended. */
  readonly sent: readonly SentOffer[];
};

export type ChallengesEvent =
  /** A read answered with the list as it now stands. */
  | { readonly type: 'listed'; readonly list: ChallengeList }
  | { readonly type: 'cancelling'; readonly id: string }
  /** The cancel was refused, so the offer's end needs a notice after all. */
  | { readonly type: 'cancel-refused'; readonly id: string }
  | { readonly type: 'dismissed'; readonly id: string };

export const holdChallenges = (list: ChallengeList): ChallengesHeld => ({
  incoming: list.incoming,
  accepted: list.accepted,
  sent: list.outgoing.map((offer) => ({ standing: 'waiting', offer })),
});

/** An offer carries only plain fields, so two are the same when every field is. */
const sameFields = (held: object, read: object): boolean => {
  const fields = Object.entries(held);
  const others: Readonly<Record<string, unknown>> = { ...read };
  return (
    fields.length === Object.keys(read).length &&
    fields.every(([name, value]) => others[name] === value)
  );
};

/** `held` itself when `read` says the same, so a list read again unchanged keeps its identity. */
const keptUnlessChanged = <T, Rows extends readonly T[]>(
  held: Rows,
  read: Rows,
  same: (held: T, read: T) => boolean,
): Rows =>
  held.length === read.length &&
  held.every((row, index) => same(row, read[index]!))
    ? held
    : read;

const sameSent = (held: SentOffer, read: SentOffer) =>
  held.standing === read.standing && sameFields(held.offer, read.offer);

/**
 * What the tab holds once `list` is read. Every read parses a new list, so
 * one that says nothing new answers `state` itself: nobody is told of it.
 */
const listed = (state: ChallengesHeld, list: ChallengeList): ChallengesHeld => {
  const held = new Map(state.sent.map((sent) => [sent.offer.id, sent]));
  const standing = new Set(list.outgoing.map((offer) => offer.id));
  const accepted = new Set(list.accepted.map((offer) => offer.id));
  const gone = state.sent.filter(
    ({ standing: was, offer }) =>
      !standing.has(offer.id) &&
      (was === 'ended' || (was === 'waiting' && !accepted.has(offer.id))),
  );
  const next: ChallengesHeld = {
    incoming: keptUnlessChanged(state.incoming, list.incoming, sameFields),
    accepted: keptUnlessChanged(state.accepted, list.accepted, sameFields),
    sent: keptUnlessChanged(
      state.sent,
      [
        ...list.outgoing.map((offer): SentOffer => ({
          standing:
            held.get(offer.id)?.standing === 'cancelling'
              ? 'cancelling'
              : 'waiting',
          offer,
        })),
        ...gone.map(({ offer }): SentOffer => ({ standing: 'ended', offer })),
      ],
      sameSent,
    ),
  };
  return next.incoming === state.incoming &&
    next.accepted === state.accepted &&
    next.sent === state.sent
    ? state
    : next;
};

/** Moves the one offer with this id out of `from`, or changes nothing. */
const restand = (
  state: ChallengesHeld,
  id: string,
  from: SentOffer['standing'],
  to: SentOffer['standing'] | null,
): ChallengesHeld => {
  const moves = (sent: SentOffer) =>
    sent.offer.id === id && sent.standing === from;
  if (!state.sent.some(moves)) return state;
  return {
    ...state,
    sent: state.sent.flatMap((sent) =>
      !moves(sent) ? [sent] : to === null ? [] : [{ ...sent, standing: to }],
    ),
  };
};

/** The pure transition of the challenges a tab holds. */
export function challengesHeld(
  state: ChallengesHeld,
  event: ChallengesEvent,
): ChallengesHeld {
  switch (event.type) {
    case 'listed':
      return listed(state, event.list);
    case 'cancelling':
      return restand(state, event.id, 'waiting', 'cancelling');
    case 'cancel-refused':
      return restand(state, event.id, 'cancelling', 'waiting');
    case 'dismissed':
      return restand(state, event.id, 'ended', null);
  }
}

/** The list as the cards and the people rows read it. */
export const challengeListOf = (state: ChallengesHeld): ChallengeList => ({
  version: 1,
  incoming: state.incoming,
  outgoing: state.sent.flatMap(({ standing, offer }) =>
    standing === 'ended' ? [] : [offer],
  ),
  accepted: state.accepted,
});

/** An offer whose end the member has yet to dismiss, told apart by its id. */
export type EndedOffer = { readonly id: string; readonly username: string };

export const endedOffersOf = (state: ChallengesHeld): readonly EndedOffer[] =>
  state.sent.flatMap(({ standing, offer }) =>
    standing === 'ended' ? [{ id: offer.id, username: offer.username }] : [],
  );
