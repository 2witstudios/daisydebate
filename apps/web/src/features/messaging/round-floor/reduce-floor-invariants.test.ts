import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { FloorEffect } from './floor-effects';
import type { FloorEvent } from './floor-events';
import { initialFloorState, type FloorState } from './floor-state';
import {
  everyEvent,
  everyState,
  NEVER_ASKED,
} from './floor-states.test-support';
import { reduceFloor } from './reduce-floor';

setupRitewayBun();

/** What must hold in every state the reducer can produce. */
const violations = (state: FloorState): readonly string[] => {
  const { standing, requests } = state;
  const bad: string[] = [];
  if (standing.kind === 'loading' && standing.request > requests)
    bad.push('an entry waits on a request never handed out');
  if (standing.kind !== 'ready') return bad;
  const { reads, marking, thread, readSequence, hidden, notice } = standing;
  const awaited = [
    ...reads.latest,
    ...reads.older,
    ...(marking ? [marking.request] : []),
  ];
  if (awaited.some((request) => request < 1 || request > requests))
    bad.push('an answer is awaited for a request never handed out');
  if (new Set(awaited).size !== awaited.length)
    bad.push('one request is awaited twice, or by two kinds');
  if (marking && marking.sequence <= readSequence)
    bad.push('a marker is on its way for messages already read');
  if (thread && thread.paging !== null && !reads.older.includes(thread.paging))
    bad.push('Older messages waits on a read that can no longer answer');
  if (!thread && reads.older.length > 0)
    bad.push('an older page is on its way to a floor with no latest page');
  if (
    hidden &&
    (marking !== null ||
      reads.older.length > 0 ||
      (thread !== null && (thread.older !== null || thread.paging !== null)))
  )
    bad.push('a hidden floor marks messages read or holds older pages');
  if (hidden && reads.latest.length > 0)
    bad.push('a hidden floor waits for a page read under withdrawn access');
  if (!thread && reads.latest.length === 0 && !hidden && notice === null)
    bad.push('no page is held, none is on its way, and nothing says why');
  if (thread && thread.history.channelId !== standing.metadata.channelId)
    bad.push('the thread is another channel');
  return bad;
};

/** A step may only move the floor in ways the product allows. */
const stepViolations = (
  before: FloorState,
  event: FloorEvent,
  after: FloorState,
  effects: readonly FloorEffect[],
): readonly string[] => {
  const bad: string[] = [];
  if (after.requests < before.requests) bad.push('a request id was reused');
  for (const effect of effects)
    if (
      'request' in effect &&
      effect.type !== 'open' &&
      effect.request !== after.requests
    )
      bad.push(`${effect.type} carries a request that was not just minted`);
  if (after.requests - before.requests > 1)
    bad.push('more than one request minted');
  if (
    before.standing.kind === 'denied' &&
    after.standing !== before.standing &&
    event.type !== 'enter-requested'
  )
    bad.push('a denied floor moved without being entered again');
  if (
    before.standing.kind === 'ready' &&
    after.standing.kind === 'ready' &&
    after.standing.readSequence < before.standing.readSequence
  )
    bad.push('the read marker moved back');
  if (
    after.standing.kind === 'ready' &&
    before.standing.kind !== 'ready' &&
    before.standing.kind !== 'loading'
  )
    bad.push('a floor opened without being entered');
  return bad;
};

test('every event in every state is total, and a rejected one changes nothing', () => {
  const problems: string[] = [];
  let pairs = 0;
  let rejected = 0;
  for (const [name, state, inFlight] of everyState()) {
    for (const [eventName, event] of everyEvent(inFlight)) {
      pairs += 1;
      const step = reduceFloor(state, event);
      if (step.state === state && step.effects.length === 0) rejected += 1;
      for (const problem of [
        ...violations(step.state),
        ...stepViolations(state, event, step.state, step.effects),
      ])
        problems.push(`${name} + ${eventName}: ${problem}`);
    }
    const never = {
      entry: NEVER_ASKED,
      latest: NEVER_ASKED,
      older: NEVER_ASKED,
      mark: NEVER_ASKED,
    };
    for (const [eventName, event] of everyEvent(never)) {
      if (!('request' in event)) continue;
      const stale = reduceFloor(state, event);
      if (stale.state !== state || stale.effects.length > 0)
        problems.push(`${name} + stale ${eventName}: not rejected`);
    }
  }
  assert({
    given: 'every shape of state and every event, current and stale',
    should:
      'never produce an impossible state, and leave the state identical for a request that is not awaited',
    actual: { problems, covered: pairs >= 300, someRejected: rejected > 100 },
    expected: { problems: [], covered: true, someRejected: true },
  });
});

/** Whether the state waits for this answer: its own kind asked for it, and nothing has answered since. */
const awaits = (
  { standing }: FloorState,
  event: Extract<FloorEvent, { readonly request: number }>,
): boolean => {
  switch (event.type) {
    case 'discovered':
    case 'opened':
    case 'entry-refused':
      return standing.kind === 'loading' && standing.request === event.request;
    case 'latest-read':
      return (
        standing.kind === 'ready' &&
        standing.reads.latest.includes(event.request)
      );
    case 'older-read':
      return (
        standing.kind === 'ready' &&
        standing.reads.older.includes(event.request)
      );
    case 'read-refused':
      return (
        standing.kind === 'ready' &&
        standing.reads[event.read].includes(event.request)
      );
    case 'read-marked':
    case 'read-mark-failed':
      return (
        standing.kind === 'ready' && standing.marking?.request === event.request
      );
  }
};

test('an answer changes nothing unless its own kind asked for it and still waits', () => {
  const problems: string[] = [];
  let crossed = 0;
  for (const [name, state] of everyState())
    for (let request = 0; request <= state.requests + 1; request += 1) {
      const ids = {
        entry: request,
        latest: request,
        older: request,
        mark: request,
      };
      const events = everyEvent(ids).flatMap(([eventName, event]) =>
        'request' in event ? [[eventName, event] as const] : [],
      );
      const awaitedByAnother = events.some(([, event]) => awaits(state, event));
      for (const [eventName, event] of events) {
        if (awaits(state, event)) continue;
        if (awaitedByAnother) crossed += 1;
        const step = reduceFloor(state, event);
        if (step.state !== state || step.effects.length > 0)
          problems.push(`${name} + ${eventName} #${request}`);
      }
    }
  assert({
    given:
      'every state and every answer it does not await, among them answers under a request another kind awaits',
    should: 'return the same state object and ask nothing',
    actual: { problems, crossedKinds: crossed > 50 },
    expected: { problems: [], crossedKinds: true },
  });
});

/** Seeded and reproducible: no ambient randomness in tests. */
const seeded = (seed: number) => {
  let value = seed >>> 0;
  return (limit: number) => {
    value = (value * 1664525 + 1013904223) >>> 0;
    // The high bits: a linear generator's low bits repeat in short cycles.
    return Math.floor((value / 2 ** 32) * limit);
  };
};

test('any sequence of events keeps the invariants', () => {
  const failures: string[] = [];
  let opened = 0;
  let denied = 0;
  for (let seed = 1; seed <= 300 && failures.length === 0; seed += 1) {
    const pick = seeded(seed);
    let state = initialFloorState;
    const trace: string[] = [];
    for (let turn = 0; turn < 120 && failures.length === 0; turn += 1) {
      // Answers arrive in any order: often the newest request's, else any ever
      // asked or one never asked.
      const any = () =>
        pick(2) === 0 ? state.requests : 1 + pick(state.requests + 1);
      const events = everyEvent({
        entry: any(),
        latest: any(),
        older: any(),
        mark: any(),
      });
      const [name, event] = events[pick(events.length)]!;
      trace.push(name);
      const step = reduceFloor(state, event);
      for (const problem of [
        ...violations(step.state),
        ...stepViolations(state, event, step.state, step.effects),
      ])
        failures.push(`seed ${seed}: ${problem}: ${trace.join(' > ')}`);
      if (step.state.standing.kind === 'ready') opened += 1;
      if (step.state.standing.kind === 'denied') denied += 1;
      state = step.state;
    }
  }
  assert({
    given: 'three hundred seeded sequences of a hundred and twenty events',
    should: 'hold every invariant, through open and denied floors alike',
    actual: {
      failures: failures.slice(0, 2),
      opened: opened > 1000,
      denied: denied > 1000,
    },
    expected: { failures: [], opened: true, denied: true },
  });
});
