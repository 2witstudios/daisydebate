import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  openingSecurityOverview,
  readInFlight,
  reduceSecurityOverview,
  type SecurityOverview,
  type SecurityOverviewEffect,
  type SecurityOverviewEvent,
} from './security-overview-model';
import {
  answerOf,
  everyEvent,
  everyState,
} from './security-overview-states.test-support';

setupRitewayBun();

const requestOf = (effect: SecurityOverviewEffect) =>
  effect.type === 'read' ? effect.version : effect.request;

/** The number each wait in this state is waiting on. */
const waits = (state: SecurityOverview): readonly number[] =>
  [
    readInFlight(state),
    state.signOut.kind === 'asking' ? state.signOut.request : null,
    state.enrolment.kind === 'waiting' ? state.enrolment.request : null,
  ].filter((id) => id !== null);

type Step = ReturnType<typeof reduceSecurityOverview>;

/** Each thing asked takes a new number, and the state waits on exactly it. */
const askedBadly = (
  before: SecurityOverview,
  { state, effects }: Step,
): readonly string[] =>
  effects.flatMap((effect) => {
    const id = requestOf(effect);
    const waiting = {
      read: readInFlight(state),
      'sign-out-others':
        state.signOut.kind === 'asking' ? state.signOut.request : null,
      enrol:
        state.enrolment.kind === 'waiting' ? state.enrolment.request : null,
    }[effect.type];
    return [
      ...(id <= before.minted || id > state.minted
        ? [`${effect.type} reuses a number`]
        : []),
      ...(waiting === id ? [] : [`${effect.type} is asked but not waited for`]),
    ];
  });

const CHECKS: readonly (readonly [
  string,
  (
    before: SecurityOverview,
    event: SecurityOverviewEvent,
    step: Step,
  ) => boolean,
])[] = [
  [
    'asks something without moving',
    (before, _event, step) => step.state === before && step.effects.length > 0,
  ],
  [
    'takes a number back',
    (before, _event, { state }) => state.minted < before.minted,
  ],
  [
    'forgets rows it had read',
    (before, _event, { state }) =>
      before.lists.kind === 'read' && state.lists.kind === 'loading',
  ],
  [
    'waits on a number never given out',
    (_before, _event, { state }) =>
      waits(state).some((id) => id > state.minted),
  ],
  [
    'two waits share a number',
    (_before, _event, { state }) =>
      new Set(waits(state)).size !== waits(state).length,
  ],
  [
    'waits for an answer nobody was asked for',
    (before, _event, { state, effects }) =>
      waits(state).some(
        (id) =>
          !waits(before).includes(id) &&
          !effects.some((effect) => requestOf(effect) === id),
      ),
  ],
  [
    'changes a sign-out it is not about',
    (before, event, { state }) =>
      !event.type.startsWith('sign-out') && state.signOut !== before.signOut,
  ],
  [
    'changes an enrolment it is not about',
    (before, event, { state }) =>
      !event.type.startsWith('enrolment') &&
      state.enrolment !== before.enrolment,
  ],
];

/** What must hold of every step the model can take. */
const violations = (
  before: SecurityOverview,
  event: SecurityOverviewEvent,
  step: Step,
): readonly string[] => [
  ...CHECKS.filter(([, broken]) => broken(before, event, step)).map(
    ([name]) => name,
  ),
  ...askedBadly(before, step),
];

test('every event in every state is total, and a stale answer changes nothing', () => {
  const problems: string[] = [];
  let pairs = 0;
  let stale = 0;
  for (const [name, state] of everyState())
    for (const [eventName, event] of everyEvent(state)) {
      pairs += 1;
      const step = reduceSecurityOverview(state, event);
      for (const bad of violations(state, event, step))
        problems.push(`${name} + ${eventName}: ${bad}`);
      if (eventName.endsWith('stale')) {
        stale += 1;
        if (step.state !== state || step.effects.length > 0)
          problems.push(`${name} + ${eventName}: a stale answer landed`);
      }
    }
  assert({
    given: 'every event, current and stale, in every state the screen can hold',
    should: 'yield a legal state, and the same state for every stale answer',
    actual: { problems, pairs, stale },
    expected: { problems: [], pairs: 48 * 15, stale: 48 * 3 },
  });
});

/** A seeded generator: the same seed walks the same sequence. */
const seeded = (seed: number) => {
  let value = seed;
  return (below: number) => {
    value = (value * 1_103_515_245 + 12_345) % 2_147_483_648;
    return value % below;
  };
};

const PRESSES: readonly SecurityOverviewEvent[] = [
  { type: 'read-asked' },
  { type: 'passkey-renamed', id: 'key-1', name: 'Renamed' },
  { type: 'passkey-removed', id: 'key-1' },
  { type: 'session-removed', id: 'there' },
  { type: 'sign-out-asked' },
  { type: 'enrolment-asked' },
];

/** The answer the world gives to something it was asked, good or bad by `pick`. */
const answerTo = (
  effect: SecurityOverviewEffect,
  pick: number,
): SecurityOverviewEvent =>
  effect.type === 'read'
    ? {
        type: 'read-answered',
        version: effect.version,
        answer: answerOf(['key-1', 'key-2'], ['here', 'there']),
      }
    : effect.type === 'sign-out-others'
      ? {
          type: 'sign-out-answered',
          request: effect.request,
          outcome: { kind: pick === 0 ? 'rate-limited' : 'ok' },
        }
      : {
          type: 'enrolment-answered',
          request: effect.request,
          outcome: { kind: pick === 0 ? 'cancelled' : 'saved' },
        };

test('whatever is pressed and however the answers are ordered, nothing strands', () => {
  const problems: string[] = [];
  for (let seed = 1; seed <= 200; seed += 1) {
    const next = seeded(seed);
    let state = openingSecurityOverview(seed % 2 ? 'It failed.' : undefined);
    const unanswered: SecurityOverviewEffect[] = [];
    const send = (event: SecurityOverviewEvent) => {
      const step = reduceSecurityOverview(state, event);
      for (const bad of violations(state, event, step))
        problems.push(`seed ${seed}: ${event.type}: ${bad}`);
      state = step.state;
      unanswered.push(...step.effects);
      for (const id of waits(state))
        if (!unanswered.some((effect) => requestOf(effect) === id))
          problems.push(
            `seed ${seed}: ${event.type}: waits with no answer coming`,
          );
    };
    send({ type: 'read-asked' });
    for (let turn = 0; turn < 60; turn += 1)
      if (unanswered.length > 0 && next(2) === 0)
        // Answers arrive in any order, a superseded read's among them.
        send(
          answerTo(unanswered.splice(next(unanswered.length), 1)[0]!, next(3)),
        );
      else send(PRESSES[next(PRESSES.length)]!);
    while (unanswered.length > 0) send(answerTo(unanswered.shift()!, 1));
    if (waits(state).length > 0 || state.lists.kind === 'loading')
      problems.push(`seed ${seed}: still waiting once every answer is in`);
  }
  assert({
    given:
      'two hundred seeded runs of presses and answers in any order, then every answer delivered',
    should:
      'keep every invariant and end with the lists read and nothing waiting',
    actual: problems,
    expected: [],
  });
});

test('a row removed while an earlier read is in flight is never put back by it', () => {
  const run = (
    state: SecurityOverview,
    events: readonly SecurityOverviewEvent[],
  ) =>
    events.reduce(
      (held, event) => reduceSecurityOverview(held, event).state,
      state,
    );
  const reading = run(openingSecurityOverview(), [
    { type: 'read-asked' },
    { type: 'read-answered', version: 1, answer: answerOf(['one', 'two'], []) },
    { type: 'read-asked' },
  ]);
  const removed = reduceSecurityOverview(reading, {
    type: 'passkey-removed',
    id: 'one',
  });
  const afterStale = reduceSecurityOverview(removed.state, {
    type: 'read-answered',
    version: 2,
    answer: answerOf(['one', 'two'], []),
  });
  assert({
    given:
      'a passkey removed while read 2 is in flight, then the answer to read 2',
    should: 'ask for read 3 and return the very same state to the old answer',
    actual: {
      asked: removed.effects,
      same: afterStale.state === removed.state,
      effects: afterStale.effects,
    },
    expected: {
      asked: [{ type: 'read', version: 3 }],
      same: true,
      effects: [],
    },
  });
});

test('lists never read hold no rows', () => {
  const opening = openingSecurityOverview();
  const empty = reduceSecurityOverview(
    reduceSecurityOverview(opening, { type: 'read-asked' }).state,
    { type: 'read-answered', version: 1, answer: answerOf([], []) },
  ).state;
  assert({
    given: 'the screen as it opens, and the screen once a read found no rows',
    should: 'hold loading with no lists at all, and two lists read as empty',
    actual: [opening.lists, empty.lists],
    expected: [
      { kind: 'loading', version: 0 },
      {
        kind: 'read',
        passkeys: { kind: 'listed', rows: [] },
        sessions: { kind: 'listed', rows: [] },
        rereading: null,
      },
    ],
  });
});
