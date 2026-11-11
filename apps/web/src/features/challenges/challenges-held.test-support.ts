import type { ChallengeList } from '@daisy/protocol';
import {
  challengesHeld,
  holdChallenges,
  type ChallengesEvent,
  type ChallengesHeld,
} from './challenges-held';

/** Test support: an offer whose id is one letter, repeated to a full id. */
export const offerId = (letter: string) => letter.repeat(24);
export const offer = (letter: string, username = 'mara') => ({
  id: offerId(letter),
  username,
  mode: 'casual' as const,
  format: 'freestyle' as const,
  createdAt: '2026-11-02T00:00:00.000Z',
  expiresAt: '2026-11-02T00:02:00.000Z',
});

export const listOf = (
  outgoing: ChallengeList['outgoing'] = [],
  accepted: readonly string[] = [],
  incoming: readonly string[] = [],
): ChallengeList => ({
  version: 1,
  incoming: incoming.map((letter) => ({
    ...offer(letter),
    actorId: offerId('z'),
  })),
  outgoing,
  accepted: accepted.map((letter) => ({
    ...offer(letter),
    roomId: offerId('r'),
  })),
});

const through = (
  list: ChallengeList,
  ...events: readonly ChallengesEvent[]
): ChallengesHeld => events.reduce(challengesHeld, holdChallenges(list));

/** Every standing the offer `a` can hold in a tab, by name. */
export const everyState = (): readonly (readonly [
  string,
  ChallengesHeld,
])[] => [
  ['not held', holdChallenges(listOf())],
  ['waiting', holdChallenges(listOf([offer('a')]))],
  [
    'cancelling',
    through(listOf([offer('a')]), { type: 'cancelling', id: offerId('a') }),
  ],
  ['ended', through(listOf([offer('a')]), { type: 'listed', list: listOf() })],
];

/** Every event, about the offer `a` and about an offer the tab never held. */
export const everyEvent = (): readonly (readonly [
  string,
  ChallengesEvent,
])[] => [
  ['listed standing', { type: 'listed', list: listOf([offer('a')]) }],
  ['listed gone', { type: 'listed', list: listOf() }],
  ['listed accepted', { type: 'listed', list: listOf([], ['a']) }],
  ['cancelling', { type: 'cancelling', id: offerId('a') }],
  ['cancel-refused', { type: 'cancel-refused', id: offerId('a') }],
  ['dismissed', { type: 'dismissed', id: offerId('a') }],
  ['cancelling another', { type: 'cancelling', id: offerId('q') }],
  ['cancel-refused another', { type: 'cancel-refused', id: offerId('q') }],
  ['dismissed another', { type: 'dismissed', id: offerId('q') }],
];

export const standingOf = (state: ChallengesHeld, letter: string) =>
  state.sent.find((sent) => sent.offer.id === offerId(letter))?.standing ??
  'not held';
