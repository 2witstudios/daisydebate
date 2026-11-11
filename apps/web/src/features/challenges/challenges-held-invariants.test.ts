import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { ChallengeList } from '@daisy/protocol';
import {
  challengeListOf,
  challengesHeld,
  endedOffersOf,
  holdChallenges,
  type ChallengesEvent,
  type ChallengesHeld,
} from './challenges-held';
import {
  everyEvent,
  everyState,
  listOf,
  offer,
  offerId,
} from './challenges-held.test-support';

setupRitewayBun();

/** What must hold in every state the reducer can produce after `list` was read. */
const violations = (
  state: ChallengesHeld,
  list: ChallengeList,
): readonly string[] => {
  const bad: string[] = [];
  const ids = state.sent.map((sent) => sent.offer.id);
  if (new Set(ids).size !== ids.length) bad.push('an offer is held twice');
  const shown = challengeListOf(state);
  if (
    JSON.stringify(shown.outgoing) !== JSON.stringify(list.outgoing) ||
    shown.incoming !== list.incoming ||
    shown.accepted !== list.accepted
  )
    bad.push('the list shown is not the list read');
  const standing = new Set(list.outgoing.map((row) => row.id));
  if (endedOffersOf(state).some((ended) => standing.has(ended.id)))
    bad.push('an offer that stands is said to have ended');
  return bad;
};

test('every event in every state yields a legal state', () => {
  const problems: string[] = [];
  for (const [name, state] of everyState())
    for (const [eventName, event] of everyEvent()) {
      const list =
        event.type === 'listed' ? event.list : challengeListOf(state);
      for (const problem of violations(challengesHeld(state, event), list))
        problems.push(`${name} + ${eventName}: ${problem}`);
    }
  assert({
    given: 'every event in every state',
    should: 'leave a state that breaks no invariant',
    actual: problems,
    expected: [],
  });
});

test('a command about an offer the tab does not hold changes nothing', () => {
  const changed = everyState().flatMap(([name, state]) =>
    (['cancelling', 'cancel-refused', 'dismissed'] as const).flatMap((type) =>
      challengesHeld(state, { type, id: offerId('q') }) === state
        ? []
        : [`${name} + ${type}`],
    ),
  );
  assert({
    given: 'each command naming an offer no state holds, in every state',
    should: 'return the same state object',
    actual: changed,
    expected: [],
  });
});

test('two offers to one person end as two notices, each dismissed by itself', () => {
  const both = challengesHeld(
    holdChallenges(listOf([offer('a', 'mara'), offer('b', 'mara')])),
    { type: 'listed', list: listOf() },
  );
  const one = challengesHeld(both, { type: 'dismissed', id: offerId('a') });
  const renewed = challengesHeld(one, {
    type: 'listed',
    list: listOf([offer('c', 'mara')]),
  });
  assert({
    given:
      'two offers to @mara that both ended, one dismissed, then a new offer to @mara',
    should:
      'hold a notice for each, drop only the dismissed one, and leave the new offer waiting beside the old notice',
    actual: [
      endedOffersOf(both),
      endedOffersOf(one),
      endedOffersOf(renewed),
      challengeListOf(renewed).outgoing.map((row) => row.id),
    ],
    expected: [
      [
        { id: offerId('a'), username: 'mara' },
        { id: offerId('b'), username: 'mara' },
      ],
      [{ id: offerId('b'), username: 'mara' }],
      [{ id: offerId('b'), username: 'mara' }],
      [offerId('c')],
    ],
  });
});

/** A small deterministic generator, so a failing walk can be replayed by seed. */
const seeded = (seed: number) => {
  let state = seed;
  return (bound: number) => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return Math.floor((state / 4294967296) * bound);
  };
};

test('seeded random walks keep every invariant and never invent a notice', () => {
  const letters = ['a', 'b', 'c', 'd'];
  const problems: string[] = [];
  for (let seed = 1; seed <= 200; seed += 1) {
    const pick = seeded(seed);
    const randomList = () =>
      listOf(
        letters.filter(() => pick(2) === 0).map((letter) => offer(letter)),
        letters.filter(() => pick(4) === 0),
        pick(3) === 0 ? ['i'] : [],
      );
    let list = randomList();
    let state = holdChallenges(list);
    for (let step = 0; step < 40; step += 1) {
      const id = offerId(letters[pick(letters.length)]!);
      const events: readonly ChallengesEvent[] = [
        { type: 'listed', list: randomList() },
        { type: 'cancelling', id },
        { type: 'cancel-refused', id },
        { type: 'dismissed', id },
      ];
      const event = events[pick(events.length)]!;
      const before = state;
      state = challengesHeld(state, event);
      if (event.type === 'listed') list = event.list;
      const beforeEnded = new Set(endedOffersOf(before).map((row) => row.id));
      const waited = new Set(
        before.sent
          .filter((sent) => sent.standing === 'waiting')
          .map((sent) => sent.offer.id),
      );
      const invented = endedOffersOf(state).filter(
        (row) => !beforeEnded.has(row.id) && !waited.has(row.id),
      );
      for (const problem of [
        ...violations(state, list),
        ...(invented.length > 0
          ? ['a notice for an offer that was not waiting']
          : []),
      ])
        problems.push(`seed ${seed} step ${step}: ${problem}`);
    }
  }
  assert({
    given: '200 seeded walks of 40 random events each',
    should: 'break no invariant at any step',
    actual: problems,
    expected: [],
  });
});
