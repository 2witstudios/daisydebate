import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  ctx,
  driver,
  everyEvent,
  everyState,
} from './media-driver.test-support';
import { initialMediaState, type MediaState } from './media-state';
import { publicationOf } from './media-publication';
import { statusOf } from './media-status';
import { testPolicy } from './media-state.test-support';
import { reduceMedia } from './reduce-media';
import { seededWalk } from '@daisy/seeded-random/testing';

setupRitewayBun();

/** What must hold in every state the reducer can produce. */
const violations = (state: MediaState): readonly string[] => {
  const { link } = state;
  const bad: string[] = [];
  const status = statusOf(state);
  if (link.phase !== 'live' && status.message.startsWith('Connected'))
    bad.push('says Connected without a live connection');

  if (link.phase === 'released' && link.why === 'refused' && status.retry)
    bad.push('offers Retry after a final refusal');
  const { timers } = state;
  // Whatever waits has a timer that ends the wait: nothing can strand.
  if (link.phase === 'released' && link.why === 'transient' && !timers.recovery)
    bad.push('a transient release with no rejoin coming');
  if (
    link.phase === 'admitting' &&
    link.ownRetry?.pausing &&
    !timers['admission-retry']
  )
    bad.push('an admission pauses for nothing');
  if (link.phase === 'live') {
    const { flight } = link.reads;
    if (flight?.stage === 'pausing' && !timers['read-retry'])
      bad.push('a read pauses for nothing');
    if (flight?.stage === 'letting-finish' && !timers['read-let-finish'])
      bad.push('a read is let finish with no limit');
    if (link.establishment.stage === 'establishing' && !timers['read-budget'])
      bad.push('a first answer has no budget');
    if (link.establishment.stage === 'established') {
      const { freshness } = link.establishment;
      if (freshness.status === 'checking' && !timers['read-budget'])
        bad.push('checking can stick');
      if (
        freshness.status === 'stale' &&
        freshness.cause === 'transient' &&
        freshness.wakeArmed &&
        !timers.recovery
      )
        bad.push('a wake is armed with no timer');
    }
    const prompting = (['camera', 'microphone'] as const).some((name) => {
      const source = link.sources[name];
      return source.phase === 'capturing' && !source.waiting;
    });
    if (link.apply && prompting && !timers['capture-patience'])
      bad.push('an open prompt holds an answer with no patience');
  } else if (
    timers['read-budget'] ||
    timers['read-retry'] ||
    timers['read-let-finish'] ||
    timers['capture-patience']
  )
    bad.push('a read timer outlives its connection');
  if (publicationOf(state) === 'ill' && link.phase === 'ended')
    bad.push('an ended call says reconnecting');
  return bad;
};

test('every event in every state is total, and a rejected one changes nothing', () => {
  const problems: string[] = [];
  let pairs = 0;
  let rejected = 0;
  for (const [name, state] of everyState()) {
    const link = state.link as {
      connection?: number;
      reads?: { flight: { ticket: number } | null };
    };
    const connection = link.connection ?? 999;
    const ticket = link.reads?.flight?.ticket ?? 999;
    for (const event of everyEvent(connection, ticket, state.timers)) {
      pairs++;
      const step = reduceMedia(state, event, ctx);
      if (step.state === state && step.effects.length === 0) rejected++;
      for (const problem of violations(step.state))
        problems.push(`${name} + ${event.type}: ${problem}`);
    }
    for (const event of everyEvent(connection + 1000, ticket + 1000)) {
      const stale =
        'connection' in event || 'ticket' in event || 'id' in event
          ? reduceMedia(state, event, ctx)
          : null;
      if (stale && (stale.state !== state || stale.effects.length > 0))
        problems.push(`${name} + stale ${event.type}: not rejected`);
    }
  }
  assert({
    given: 'all fifteen shapes of state and every event, current and stale',
    should:
      'never produce an impossible state, and leave state identical for stale identity',
    actual: { problems, covered: pairs > 700, someRejected: rejected > 100 },
    expected: { problems: [], covered: true, someRejected: true },
  });
});

test('an ended call absorbs every event', () => {
  const ended = driver();
  ended.send({ type: 'page-left' });
  const state = ended.state();
  assert({
    given: 'an ended call and every event',
    should: 'return the same state and ask nothing',
    actual: everyEvent(1, 1).filter((event) => {
      const step = reduceMedia(state, event, ctx);
      return step.state !== state || step.effects.length > 0;
    }),
    expected: [],
  });
});

test('any sequence of events keeps the invariants', () => {
  type Walk = { readonly state: MediaState; readonly atMs: number };
  const report = seededWalk({
    seed: 1,
    runs: 400,
    steps: 120,
    start: (): Walk => ({
      state: initialMediaState({ roundViewVersion: 1, microphoneMuted: false }),
      atMs: 0,
    }),
    moves: ({ state }: Walk) => {
      const link = state.link as {
        connection?: number;
        reads?: { flight: { ticket: number } | null };
      };
      return everyEvent(
        link.connection ?? 1,
        link.reads?.flight?.ticket ?? 1,
        state.timers,
      ).filter(
        (event) => event.type !== 'page-left' && event.type !== 'round-ended',
      );
    },
    label: (event) => event.type,
    step: ({ state, atMs: before }, event, draw) => {
      const atMs = before + draw(3_000);
      const next = reduceMedia(state, event, { atMs, policy: testPolicy });
      const started = next.effects.filter(
        (effect) => effect.type === 'start-read',
      ).length;
      const hadFlight =
        state.link.phase === 'live' && state.link.reads.flight !== null;
      const secondRead =
        started > 1 ||
        (started === 1 && hadFlight && event.type !== 'timer-fired');
      return {
        state: { state: next.state, atMs },
        problems: [
          ...(secondRead ? ['a second read started'] : []),
          ...violations(next.state),
        ],
      };
    },
  });
  assert({
    given: 'four hundred seeded walks of up to a hundred and twenty events',
    should: 'hold every invariant, and run at most one read at a time',
    actual: report.failure,
    expected: null,
  });
});
