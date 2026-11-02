import { assert, setupRitewayBun, test } from 'riteway/bun';
import { snapshot } from '../media-fixtures.test-support';
import { admission } from '../media-fixtures.test-support';
import type { MediaEffect, MediaTimer } from './media-effects';
import type { MediaEvent } from './media-events';
import { initialMediaState, type MediaState, type Source } from './media-state';
import { connectionOf, statusOf } from './media-status';
import { publicationOf } from './media-publication';
import { answerWith, testPolicy } from './media-state.test-support';
import { reduceMedia } from './reduce-media';

setupRitewayBun();

/** Runs events through the pure reducer and keeps what each asked of the world. */
const driver = (start?: MediaState) => {
  let state =
    start ?? initialMediaState({ roundViewVersion: 1, microphoneMuted: false });
  let atMs = 1_000_000;
  const effects: MediaEffect[] = [];
  const send = (event: MediaEvent) => {
    const step = reduceMedia(state, event, { atMs, policy: testPolicy });
    state = step.state;
    effects.push(...step.effects);
    return step;
  };
  const count = (type: MediaEffect['type']) =>
    effects.filter((effect) => effect.type === type).length;
  const live = () => {
    if (state.link.phase !== 'live') throw new Error('Not live');
    return state.link;
  };
  const ticket = () => {
    const flight = live().reads.flight;
    if (!flight) throw new Error('No read in flight');
    return flight.ticket;
  };
  const answer = (publish: readonly Source[] = []) =>
    send({
      type: 'read-answered',
      ticket: ticket(),
      answer: answerWith(publish),
    });
  const connection = () => {
    const { link } = state;
    if (
      link.phase === 'admitting' ||
      link.phase === 'connecting' ||
      link.phase === 'live'
    )
      return link.connection;
    throw new Error('No connection');
  };
  const room = (event: Record<string, unknown> & { type: string }) =>
    send({ ...event, connection: connection() } as MediaEvent);
  /** Up and answered once, with these grants settled. */
  const join = (publish: readonly Source[] = []) => {
    send({ type: 'tab-changed', owns: true });
    send({ type: 'admission-answered', connection: connection(), admission });
    room({ type: 'connected', permission: null });
    answer(publish);
    for (const source of publish) {
      room({ type: 'captured', source });
      room({ type: 'published', source });
    }
    if (publish.length > 0 && !publish.includes('microphone')) {
      room({ type: 'captured', source: 'microphone' });
    }
    effects.length = 0;
  };
  const flushDeferred = () => send({ type: 'read-start-due' });
  return {
    send,
    room,
    join,
    answer,
    ticket,
    live,
    count,
    effects,
    flushDeferred,
    state: () => state,
    advance: (ms: number) => void (atMs += ms),
    timer: (timer: MediaTimer) => send({ type: 'timer-fired', timer }),
    scheduled: (timer: MediaTimer) =>
      effects.flatMap((effect) =>
        effect.type === 'schedule' && effect.timer === timer ? [effect.ms] : [],
      ),
  };
};

/** One state of every phase and shape the reducer can hold. */
const everyState = (): readonly (readonly [string, MediaState])[] => {
  const at = (build: (d: ReturnType<typeof driver>) => void) => {
    const d = driver();
    build(d);
    return d.state();
  };
  const connecting = (d: ReturnType<typeof driver>) => {
    d.send({ type: 'tab-changed', owns: true });
    d.send({
      type: 'admission-answered',
      connection: (d.state().link as { connection: number }).connection,
      admission,
    });
  };
  return [
    ['waiting', at(() => undefined)],
    ['elsewhere', at((d) => d.send({ type: 'tab-changed', owns: false }))],
    ['admitting', at((d) => d.send({ type: 'tab-changed', owns: true }))],
    ['connecting', at(connecting)],
    [
      'first read',
      at((d) => {
        connecting(d);
        d.room({ type: 'connected', permission: null });
      }),
    ],
    ['live', at((d) => d.join())],
    [
      'live publishing',
      at((d) => {
        d.join();
        d.send({ type: 'read-requested', read: { kind: 'wake' } });
        d.flushDeferred();
        d.answer(['camera']);
        d.room({ type: 'captured', source: 'camera' });
      }),
    ],
    [
      'live capturing',
      at((d) => {
        d.join();
        d.send({ type: 'read-requested', read: { kind: 'wake' } });
        d.flushDeferred();
        d.answer(['camera', 'microphone']);
      }),
    ],
    ['live published', at((d) => d.join(['camera', 'microphone']))],
    [
      'live stale',
      at((d) => {
        d.join();
        d.send({ type: 'read-requested', read: { kind: 'wake' } });
        d.flushDeferred();
        d.send({
          type: 'read-failed',
          ticket: d.ticket(),
          failure: 'definite',
        });
      }),
    ],
    [
      'released transient',
      at((d) => {
        d.join();
        d.room({ type: 'dropped' });
      }),
    ],
    [
      'released definite',
      at((d) => {
        d.join();
        d.send({ type: 'read-requested', read: { kind: 'wake' } });
        d.flushDeferred();
        d.send({ type: 'read-failed', ticket: d.ticket(), failure: 'ending' });
      }),
    ],
    [
      'released refused',
      at((d) => {
        d.send({ type: 'tab-changed', owns: true });
        d.send({
          type: 'admission-failed',
          connection: (d.state().link as { connection: number }).connection,
          failure: 'refused',
        });
      }),
    ],
    [
      'released replaced',
      at((d) => {
        d.join();
        d.room({ type: 'replaced' });
      }),
    ],
    ['ended', at((d) => d.send({ type: 'page-left' }))],
  ];
};

const everyEvent = (
  connection: number,
  ticket: number,
): readonly MediaEvent[] => {
  const room = (event: Record<string, unknown>) =>
    ({ ...event, connection }) as MediaEvent;
  return [
    { type: 'tab-changed', owns: true },
    { type: 'tab-changed', owns: false },
    { type: 'tab-changed', owns: null },
    { type: 'page-left' },
    { type: 'frozen-page-restored' },
    { type: 'round-ended' },
    { type: 'mute-restored', muted: true },
    { type: 'admission-answered', connection, admission },
    { type: 'admission-failed', connection, failure: 'transient' },
    { type: 'admission-failed', connection, failure: 'refused' },
    { type: 'read-requested', read: { kind: 'wake' } },
    { type: 'read-requested', read: { kind: 'view', roundViewVersion: 99 } },
    {
      type: 'read-requested',
      read: { kind: 'boundary', roundViewVersion: 1, deadlineMs: 5 },
    },
    { type: 'read-start-due' },
    { type: 'read-answered', ticket, answer: answerWith(['camera']) },
    {
      type: 'read-answered',
      ticket,
      answer: { ...snapshot, state: 'ended' } as never,
    },
    {
      type: 'read-answered',
      ticket,
      answer: { ...snapshot, state: 'unavailable' } as never,
    },
    { type: 'read-failed', ticket, failure: 'transient' },
    { type: 'read-failed', ticket, failure: 'definite' },
    { type: 'read-failed', ticket, failure: 'ending' },
    { type: 'read-failed', ticket, failure: 'refused' },
    { type: 'read-aborted', ticket },
    ...(
      [
        'admission-retry',
        'read-retry',
        'read-budget',
        'read-let-finish',
        'capture-patience',
        'recovery',
      ] as const
    ).map((timer): MediaEvent => ({ type: 'timer-fired', timer })),
    { type: 'browser-nudged' },
    { type: 'retry-pressed' },
    { type: 'mute-requested', muted: true },
    { type: 'enable-sound-pressed' },
    { type: 'forget-failed', sources: ['camera'] },
    room({ type: 'connected', permission: null }),
    room({ type: 'connect-failed', failure: 'transient' }),
    room({ type: 'dropped' }),
    room({ type: 'replaced' }),
    room({ type: 'room-changed' }),
    room({ type: 'permission-changed', permission: ['camera'] }),
    room({ type: 'observed', tracks: [], peers: [] }),
    ...(['camera', 'microphone'] as const).flatMap((source) => [
      room({ type: 'captured', source }),
      room({
        type: 'capture-failed',
        source,
        kind: 'permission',
        checked: false,
      }),
      room({ type: 'capture-failed', source, kind: 'absence', checked: true }),
      room({ type: 'published', source }),
      room({ type: 'publish-failed', source, kind: 'failure' }),
      room({ type: 'unpublished', source }),
      room({ type: 'unpublish-failed', source }),
      room({ type: 'track-ended', source }),
      room({ type: 'device-swapped', source }),
    ]),
    room({ type: 'mute-applied', muted: true }),
    room({ type: 'mute-failed', kind: 'failure' }),
    room({ type: 'playback-changed', allowed: false }),
  ];
};

const ctx = { atMs: 2_000_000, policy: testPolicy };

/** What must hold in every state the reducer can produce. */
const violations = (state: MediaState): readonly string[] => {
  const { link } = state;
  const bad: string[] = [];
  const status = statusOf(state);
  if (link.phase !== 'live' && status.message.startsWith('Connected'))
    bad.push('says Connected without a live connection');
  if (
    link.phase === 'live' &&
    !link.established &&
    connectionOf(state) === 'out-of-date'
  )
    bad.push('out of date before ever going live');
  if (link.phase === 'released' && link.why === 'refused' && status.retry)
    bad.push('offers Retry after a final refusal');
  if (state.recovery.armed === 'rejoin' && link.phase !== 'released')
    bad.push('a rejoin is armed on something not released');
  if (state.recovery.armed === 'wake' && link.phase !== 'live')
    bad.push('a wake is armed with nothing to read on');
  if (link.phase === 'live') {
    const { flight, queued } = link.reads;
    if (flight && flight.stage !== 'requesting' && flight.stage !== 'pausing')
      bad.push('unknown read stage');
    void queued;
    if (link.apply.next && !link.apply.running)
      bad.push('an answer waits behind nothing');
  }
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
    for (const event of everyEvent(connection, ticket)) {
      pairs++;
      const step = reduceMedia(state, event, ctx);
      if (step.state === state && step.effects.length === 0) rejected++;
      for (const problem of violations(step.state))
        problems.push(`${name} + ${event.type}: ${problem}`);
    }
    for (const event of everyEvent(connection + 1000, ticket + 1000)) {
      const stale =
        'connection' in event || 'ticket' in event
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

/** Seeded and reproducible: no ambient randomness in tests. */
const seeded = (seed: number) => {
  let value = seed >>> 0;
  return (limit: number) => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value % limit;
  };
};

test('any sequence of events keeps the invariants', () => {
  const failures: string[] = [];
  for (let seed = 1; seed <= 200; seed++) {
    const pick = seeded(seed);
    let state = initialMediaState({
      roundViewVersion: 1,
      microphoneMuted: false,
    });
    let atMs = 0;
    let liveReads = 0;
    const trace: string[] = [];
    for (let step = 0; step < 120 && failures.length === 0; step++) {
      const link = state.link as {
        connection?: number;
        reads?: { flight: { ticket: number } | null };
      };
      const events = everyEvent(
        link.connection ?? 1,
        link.reads?.flight?.ticket ?? 1,
      ).filter(
        (event) => event.type !== 'page-left' && event.type !== 'round-ended',
      );
      const event = events[pick(events.length)]!;
      trace.push(event.type);
      atMs += pick(3_000);
      const next = reduceMedia(state, event, { atMs, policy: testPolicy });
      const started = next.effects.filter(
        (e) => e.type === 'start-read',
      ).length;
      const hadFlight =
        state.link.phase === 'live' && state.link.reads.flight !== null;
      if (
        started > 1 ||
        (started === 1 && hadFlight && event.type !== 'timer-fired')
      )
        failures.push(
          `seed ${seed}: a second read started: ${trace.join(' ')}`,
        );
      liveReads += started;
      state = next.state;
      for (const problem of violations(state))
        failures.push(`seed ${seed}: ${problem}: ${trace.join(' ')}`);
    }
    void liveReads;
  }
  assert({
    given: 'two hundred seeded sequences of a hundred and twenty events',
    should: 'hold every invariant, and run at most one read at a time',
    actual: failures.slice(0, 2),
    expected: [],
  });
});

test('a burst of read requests costs one read', () => {
  const d = driver();
  d.join();
  d.send({
    type: 'read-requested',
    read: { kind: 'view', roundViewVersion: 2 },
  });
  d.send({ type: 'read-requested', read: { kind: 'wake' } });
  d.send({
    type: 'read-requested',
    read: { kind: 'boundary', roundViewVersion: 2, deadlineMs: 50 },
  });
  d.flushDeferred();
  assert({
    given: 'a newer view, a wake and a due deadline in one burst',
    should: 'start one read and abort none',
    actual: [d.count('start-read'), d.count('abort-read')],
    expected: [1, 0],
  });
});

test('repeated wakes share one flight and exactly one followup', () => {
  const d = driver();
  d.join();
  d.send({ type: 'read-requested', read: { kind: 'wake' } });
  d.flushDeferred();
  for (let i = 0; i < 5; i++)
    d.send({ type: 'read-requested', read: { kind: 'wake' } });
  const during = d.count('start-read');
  d.answer();
  d.flushDeferred();
  const followed = d.count('start-read');
  d.answer();
  assert({
    given: 'many duplicate wakes during one pending read',
    should: 'share one flight and queue only one followup',
    actual: [during, followed, d.count('start-read'), connectionOf(d.state())],
    expected: [1, 2, 2, 'live'],
  });
});

test('live reads that all fail keep the connection, then recover on it without Retry (DEC-283)', () => {
  const d = driver();
  d.join(['camera']);
  d.send({ type: 'read-requested', read: { kind: 'wake' } });
  d.flushDeferred();
  for (const delay of testPolicy.requestRetryDelaysMs) {
    d.send({ type: 'read-failed', ticket: d.ticket(), failure: 'transient' });
    d.timer('read-retry');
    void delay;
  }
  d.send({ type: 'read-failed', ticket: d.ticket(), failure: 'transient' });
  const stalled = {
    connection: connectionOf(d.state()),
    released: d.count('release-connection'),
    waiting: d.scheduled('recovery'),
  };
  d.timer('recovery');
  d.send({ type: 'read-failed', ticket: d.ticket(), failure: 'transient' });
  d.timer('read-retry');
  d.answer(['camera']);
  assert({
    given: 'a live connection whose reads fail until the server is healthy',
    should:
      'show out of date, read again at the pace, and return to live on the same connection with no admission',
    actual: {
      stalled,
      connection: connectionOf(d.state()),
      admissions: d.count('admit'),
      released: d.count('release-connection'),
      armed: d.state().recovery.armed,
    },
    expected: {
      stalled: { connection: 'out-of-date', released: 0, waiting: [1_000] },
      connection: 'live',
      admissions: 0,
      released: 0,
      armed: null,
    },
  });
});

test('a dropped connection is released at once, nothing reads on it, and it rejoins once', () => {
  const d = driver();
  d.join(['camera']);
  d.advance(10_000);
  d.send({ type: 'read-requested', read: { kind: 'wake' } });
  d.flushDeferred();
  d.send({ type: 'read-failed', ticket: d.ticket(), failure: 'definite' });
  d.room({ type: 'dropped' });
  const dropped = {
    connection: connectionOf(d.state()),
    status: statusOf(d.state()).retry,
    released: d.count('release-connection'),
  };
  d.send({ type: 'read-requested', read: { kind: 'wake' } });
  const inert = d.count('start-read');
  d.timer('recovery');
  assert({
    given: 'a read failing, then a drop, then a wake',
    should: 'show unavailable with Retry, read nothing, and make one admission',
    actual: { dropped, inert, admissions: d.count('admit') },
    expected: {
      dropped: { connection: 'unavailable', status: true, released: 1 },
      inert: 1,
      admissions: 1,
    },
  });
});

test('the pace: only the first join retries, and only a connection that held resets it', () => {
  const d = driver();
  d.send({ type: 'tab-changed', owns: true });
  const connection = () =>
    (d.state().link as { connection: number }).connection;
  for (let i = 0; i < 3; i++) {
    d.send({
      type: 'admission-failed',
      connection: connection(),
      failure: 'transient',
    });
    d.timer('admission-retry');
  }
  d.send({
    type: 'admission-failed',
    connection: connection(),
    failure: 'transient',
  });
  const firstJoin = d.count('admit');
  d.timer('recovery');
  const oneMore = d.count('admit') - firstJoin;
  d.send({
    type: 'admission-failed',
    connection: connection(),
    failure: 'transient',
  });
  d.timer('recovery');
  d.send({
    type: 'admission-failed',
    connection: connection(),
    failure: 'transient',
  });
  const paced = d.scheduled('recovery');
  d.timer('recovery');
  d.send({ type: 'admission-answered', connection: connection(), admission });
  d.room({ type: 'connected', permission: null });
  d.answer();
  d.room({ type: 'dropped' });
  const flapped = d.scheduled('recovery').at(-1);
  d.timer('recovery');
  d.send({ type: 'admission-answered', connection: connection(), admission });
  d.room({ type: 'connected', permission: null });
  d.answer();
  d.advance(5_000);
  d.room({ type: 'dropped' });
  assert({
    given: 'admissions refused for now, then a connection that drops',
    should:
      'retry only the first join, one admission per cycle, keep the pace through a flap, and reset once it held',
    actual: {
      firstJoin,
      oneMore,
      paced,
      flapped,
      afterHeld: d.scheduled('recovery').at(-1),
    },
    expected: {
      firstJoin: 4,
      oneMore: 1,
      paced: [1_000, 2_000, 4_000],
      flapped: 8_000,
      afterHeld: 1_000,
    },
  });
});

test('an event moves a waiting attempt up, once per floor, and never restarts what is final', () => {
  const d = driver();
  d.join();
  d.room({ type: 'dropped' });
  d.advance(5_000);
  d.send({ type: 'browser-nudged' });
  const moved = d.count('admit');
  const connection = (d.state().link as { connection: number }).connection;
  d.send({ type: 'admission-failed', connection, failure: 'transient' });
  d.send({ type: 'browser-nudged' });
  const inFloor = d.count('admit');
  d.advance(5_000);
  d.send({ type: 'browser-nudged' });
  const second = d.count('admit');
  d.send({
    type: 'admission-failed',
    connection: (d.state().link as { connection: number }).connection,
    failure: 'refused',
  });
  d.advance(5_000);
  d.send({ type: 'browser-nudged' });
  assert({
    given:
      'a waiting attempt, events inside and past the floor, then a refusal',
    should: 'move up once per floor, and stop for good after the refusal',
    actual: {
      moved,
      inFloor,
      second,
      final: d.count('admit'),
      armed: d.state().recovery.armed,
    },
    expected: { moved: 1, inFloor: 1, second: 2, final: 2, armed: null },
  });
});

test('an event reads again on a live page, at most once per floor', () => {
  const d = driver();
  d.join();
  d.advance(5_000);
  d.send({ type: 'browser-nudged' });
  const first = d.count('start-read');
  d.send({ type: 'browser-nudged' });
  assert({
    given: 'a live page, an online event, and another at once',
    should: 'read for the first only',
    actual: [first, d.count('start-read')],
    expected: [1, 1],
  });
});

test('Retry keeps a working connection and re-attempts what failed', () => {
  const d = driver();
  d.join(['microphone']);
  d.send({ type: 'read-requested', read: { kind: 'wake' } });
  d.flushDeferred();
  d.answer(['camera', 'microphone']);
  d.room({
    type: 'capture-failed',
    source: 'camera',
    kind: 'permission',
    checked: false,
  });
  d.effects.length = 0;
  d.send({ type: 'retry-pressed' });
  assert({
    given: 'a live connection with a failed camera, then Retry',
    should: 'capture again and read again, with no admission and no release',
    actual: [
      d.count('capture'),
      d.count('admit'),
      d.count('release-connection'),
      d.live().sources.camera.phase,
    ],
    expected: [1, 0, 0, 'capturing'],
  });
});

test('Retry while out of date reads and keeps the connection; only stuck work rebuilds', () => {
  const stale = driver();
  stale.join();
  stale.send({ type: 'read-requested', read: { kind: 'wake' } });
  stale.flushDeferred();
  stale.send({
    type: 'read-failed',
    ticket: stale.ticket(),
    failure: 'definite',
  });
  stale.effects.length = 0;
  stale.send({ type: 'retry-pressed' });
  const stuck = driver();
  stuck.join();
  stuck.send({ type: 'read-requested', read: { kind: 'wake' } });
  stuck.flushDeferred();
  stuck.answer(['camera']);
  stuck.room({ type: 'captured', source: 'camera' });
  stuck.effects.length = 0;
  stuck.advance(testPolicy.readBudgetMs);
  stuck.send({ type: 'retry-pressed' });
  assert({
    given:
      'Retry during failing reads, and Retry with a publish stuck past the budget',
    should: 'keep the first connection and rebuild the second (ISSUE-956)',
    actual: [
      [
        stale.count('release-connection'),
        stale.count('admit'),
        stale.count('start-read'),
      ],
      [stuck.count('release-connection'), stuck.count('admit')],
    ],
    expected: [
      [0, 0, 1],
      [1, 1],
    ],
  });
});

test('Retry after release rejoins, except after a final refusal', () => {
  const retry = (why: 'definite' | 'refused') => {
    const d = driver();
    d.send({ type: 'tab-changed', owns: true });
    d.send({
      type: 'admission-failed',
      connection: (d.state().link as { connection: number }).connection,
      failure: why,
    });
    d.effects.length = 0;
    d.send({ type: 'retry-pressed' });
    return d.count('admit');
  };
  assert({
    given: 'Retry after a definite failure and after a refusal',
    should: 'admit for the first and do nothing for the second',
    actual: [retry('definite'), retry('refused')],
    expected: [1, 0],
  });
});

test('a checked device gone is forgotten on Retry, and a failed forget keeps it named', () => {
  const d = driver();
  d.join(['microphone']);
  d.send({ type: 'read-requested', read: { kind: 'wake' } });
  d.flushDeferred();
  d.answer(['camera', 'microphone']);
  d.room({
    type: 'capture-failed',
    source: 'camera',
    kind: 'absence',
    checked: true,
  });
  const named = d.live().sources.camera.phase;
  d.effects.length = 0;
  d.send({ type: 'retry-pressed' });
  const forgets = d.effects.filter((e) => e.type === 'forget-checked-devices');
  d.send({ type: 'forget-failed', sources: ['camera'] });
  assert({
    given: 'a checked camera absent, Retry, and storage refusing the forget',
    should: 'forget that source alone, and keep naming it if that fails',
    actual: { named, forgets, after: d.live().sources.camera.phase },
    expected: {
      named: 'missing',
      forgets: [{ type: 'forget-checked-devices', sources: ['camera'] }],
      after: 'missing',
    },
  });
});

test('Retry uses defaults only for a saved choice nothing can read', () => {
  const retried = (
    kind: 'preference-unreadable' | 'preference-invalid' | 'failure',
  ) => {
    const d = driver();
    d.join(['microphone']);
    d.send({ type: 'read-requested', read: { kind: 'wake' } });
    d.flushDeferred();
    d.answer(['camera', 'microphone']);
    d.room({ type: 'capture-failed', source: 'camera', kind, checked: false });
    d.effects.length = 0;
    d.send({ type: 'retry-pressed' });
    return d.count('use-default-devices');
  };
  assert({
    given: 'an unreadable and an invalid preference, and a device failure',
    should: 'use defaults only for the first two',
    actual: [
      retried('preference-unreadable'),
      retried('preference-invalid'),
      retried('failure'),
    ],
    expected: [1, 1, 0],
  });
});

test('a superseded answer never starts or announces, and fresh work follows the running apply', () => {
  const d = driver();
  d.join();
  d.send({ type: 'read-requested', read: { kind: 'wake' } });
  d.flushDeferred();
  d.answer(['camera', 'microphone']);
  d.room({ type: 'captured', source: 'camera' });
  const running = d.live().apply.running !== null;
  d.send({
    type: 'read-requested',
    read: { kind: 'view', roundViewVersion: 4 },
  });
  d.flushDeferred();
  d.answer(['microphone']);
  const queued = d.live().apply.next?.answer.grants.publish;
  d.send({
    type: 'read-requested',
    read: { kind: 'view', roundViewVersion: 5 },
  });
  d.flushDeferred();
  const droppedOlder = d.live().apply.next;
  d.answer(['camera']);
  const media = d.live().media?.grants.publish;
  d.room({ type: 'published', source: 'camera' });
  d.room({ type: 'captured', source: 'microphone' });
  d.room({ type: 'published', source: 'microphone' });
  d.room({ type: 'unpublished', source: 'microphone' });
  assert({
    given: 'two newer views while an old apply is still running',
    should:
      'read fresh for both, drop the superseded queued answer, and let the running one announce nothing',
    actual: {
      running,
      queued,
      droppedOlder,
      media,
      finalAnswer: d.live().media?.grants.publish,
      grants: d.live().grants,
    },
    expected: {
      running: true,
      queued: ['microphone'],
      droppedOlder: null,
      media: [],
      finalAnswer: ['camera'],
      grants: ['camera'],
    },
  });
});

test('a stale reply is fenced whatever it says', () => {
  const late = (answer: unknown) => {
    const d = driver();
    d.join();
    d.send({ type: 'read-requested', read: { kind: 'wake' } });
    d.flushDeferred();
    const old = d.ticket();
    d.send({
      type: 'read-requested',
      read: { kind: 'view', roundViewVersion: 4 },
    });
    const step = d.send({
      type: 'read-answered',
      ticket: old,
      answer: answer as never,
    });
    return [
      connectionOf(d.state()),
      d.count('release-connection'),
      step.state.link.phase,
    ];
  };
  assert({
    given: 'an ended or unavailable reply to a superseded read',
    should: 'leave the connection live',
    actual: [
      late({ ...snapshot, state: 'ended' }),
      late({ ...snapshot, state: 'unavailable' }),
    ],
    expected: [
      ['live', 0, 'live'],
      ['live', 0, 'live'],
    ],
  });
});

test('in a burst a young read finishes and an old one is aborted', () => {
  const d = driver();
  d.join();
  d.send({ type: 'read-requested', read: { kind: 'wake' } });
  d.flushDeferred();
  d.send({
    type: 'read-requested',
    read: { kind: 'view', roundViewVersion: 2 },
  });
  const firstAborts = d.count('abort-read');
  d.send({ type: 'read-aborted', ticket: d.ticket() });
  d.advance(500);
  d.send({
    type: 'read-requested',
    read: { kind: 'view', roundViewVersion: 3 },
  });
  const young = [d.count('abort-read'), d.scheduled('read-let-finish')];
  d.timer('read-let-finish');
  assert({
    given:
      'a first supersession, then one on a read 500 ms old, then its limit',
    should:
      'abort the first, let the young one finish, and abort it at the limit',
    actual: { firstAborts, young, afterLimit: d.count('abort-read') },
    expected: { firstAborts: 1, young: [1, [1_500]], afterLimit: 2 },
  });
});

test('superseded reads still show out of date at the budget, and an answer ends it', () => {
  const d = driver();
  d.join();
  d.send({
    type: 'read-requested',
    read: { kind: 'view', roundViewVersion: 2 },
  });
  const checking = [d.live().freshness, d.scheduled('read-budget')];
  d.timer('read-budget');
  const overdue = connectionOf(d.state());
  const answered = driver();
  answered.join();
  answered.send({
    type: 'read-requested',
    read: { kind: 'view', roundViewVersion: 2 },
  });
  answered.flushDeferred();
  answered.answer();
  assert({
    given: 'reads superseded past the budget, and one answered in time',
    should:
      'show out of date for the first, and cancel the budget for the second',
    actual: {
      checking,
      overdue,
      cancelled: answered.effects.some(
        (effect) => effect.type === 'cancel' && effect.timer === 'read-budget',
      ),
      current: answered.live().freshness,
    },
    expected: {
      checking: ['checking', [testPolicy.readBudgetMs]],
      overdue: 'out-of-date',
      cancelled: true,
      current: 'current',
    },
  });
});

test('a first apply that hangs reaches a way out, and rejoins by itself', () => {
  const d = driver();
  d.send({ type: 'tab-changed', owns: true });
  d.send({
    type: 'admission-answered',
    connection: (d.state().link as { connection: number }).connection,
    admission,
  });
  d.room({ type: 'connected', permission: null });
  d.answer(['camera']);
  d.room({ type: 'captured', source: 'camera' });
  const before = connectionOf(d.state());
  d.timer('read-budget');
  assert({
    given: 'a first publish that never settles past the read budget',
    should: 'release it, offer Retry and arm one rejoin',
    actual: {
      before,
      after: connectionOf(d.state()),
      retry: statusOf(d.state()).retry,
      armed: d.state().recovery.armed,
    },
    expected: {
      before: 'connecting',
      after: 'unavailable',
      retry: true,
      armed: 'rejoin',
    },
  });
});

test('patience ends for an open prompt, never for a hung publish', () => {
  const prompt = driver();
  prompt.join();
  prompt.send({ type: 'read-requested', read: { kind: 'wake' } });
  prompt.flushDeferred();
  prompt.answer(['camera']);
  prompt.timer('capture-patience');
  const hung = driver();
  hung.join();
  hung.send({ type: 'read-requested', read: { kind: 'wake' } });
  hung.flushDeferred();
  hung.answer(['camera']);
  hung.room({ type: 'captured', source: 'camera' });
  hung.timer('capture-patience');
  assert({
    given: 'a prompt nobody answers, and a capture whose publish never settles',
    should:
      'finish the answer for the first and keep it running for the second',
    actual: [
      prompt.live().apply.running === null,
      prompt.live().sources.camera,
      hung.live().apply.running === null,
    ],
    expected: [true, { phase: 'capturing', waiting: true }, false],
  });
});

test('a source decides per source: one failure leaves the other working', () => {
  const d = driver();
  d.join();
  d.send({ type: 'read-requested', read: { kind: 'wake' } });
  d.flushDeferred();
  d.answer(['camera', 'microphone']);
  d.room({
    type: 'capture-failed',
    source: 'camera',
    kind: 'failure',
    checked: false,
  });
  d.room({ type: 'captured', source: 'microphone' });
  d.room({ type: 'published', source: 'microphone' });
  assert({
    given: 'a camera that cannot start and a working microphone',
    should: 'publish the microphone, name the camera and keep the connection',
    actual: [
      d.live().sources.microphone.phase,
      d.live().sources.camera.phase,
      connectionOf(d.state()),
      d.count('release-connection'),
    ],
    expected: ['published', 'failed', 'live', 0],
  });
});

test('LiveKit permission outranks a reply crossing it', () => {
  const d = driver();
  d.join(['camera', 'microphone']);
  d.room({ type: 'permission-changed', permission: ['camera'] });
  const closing = d.live().sources.microphone.phase;
  d.room({ type: 'unpublished', source: 'microphone' });
  d.send({ type: 'read-start-due' });
  d.answer(['camera', 'microphone']);
  assert({
    given: 'the microphone permission dropping, then a reply still granting it',
    should: 'keep it warm and not publish it',
    actual: [closing, d.live().sources.microphone.phase],
    expected: ['unpublishing', 'warm'],
  });
});

test('a failed source waits for Retry or a new grant, never each read', () => {
  const d = driver();
  d.join();
  d.send({ type: 'read-requested', read: { kind: 'wake' } });
  d.flushDeferred();
  d.answer(['camera']);
  d.room({
    type: 'capture-failed',
    source: 'camera',
    kind: 'permission',
    checked: false,
  });
  d.room({ type: 'captured', source: 'microphone' });
  d.effects.length = 0;
  d.send({ type: 'read-requested', read: { kind: 'wake' } });
  d.flushDeferred();
  d.answer(['camera']);
  const again = d.count('capture');
  d.send({ type: 'read-start-due' });
  d.send({ type: 'read-requested', read: { kind: 'wake' } });
  d.flushDeferred();
  d.answer([]);
  const cleared = d.live().sources.camera.phase;
  d.send({ type: 'read-requested', read: { kind: 'wake' } });
  d.flushDeferred();
  d.answer(['camera']);
  assert({
    given:
      'a failed camera, another read, the grant going, and the grant returning',
    should:
      'not capture on the read, clear it when unwanted, and try once on the new grant',
    // Two captures on the new grant: the camera, and a warm microphone again.
    actual: [again, cleared, d.count('capture')],
    expected: [0, 'off', 2],
  });
});

test('a failed unpublish stays named until the next grant or Retry', () => {
  const d = driver();
  d.join(['camera']);
  d.room({ type: 'permission-changed', permission: [] });
  d.room({ type: 'unpublish-failed', source: 'camera' });
  const named = d.live().sources.camera.phase;
  d.send({ type: 'read-start-due' });
  d.answer([]);
  const afterRead = d.live().sources.camera.phase;
  d.room({ type: 'permission-changed', permission: ['camera'] });
  assert({
    given: 'a camera the SDK would not remove, another read, then a new grant',
    should: 'keep naming it through the read and try again on the grant',
    actual: [
      named,
      afterRead,
      statusOf(d.state()).retry,
      d.live().sources.camera.phase,
    ],
    expected: ['stale-publication', 'stale-publication', false, 'capturing'],
  });
});

test('a seat replaced elsewhere is named and sets no timer', () => {
  const d = driver();
  d.join();
  d.room({ type: 'replaced' });
  const status = statusOf(d.state());
  assert({
    given: 'this seat connecting from another tab or device',
    should: 'say so, offer to take it back, and not fight for it',
    actual: {
      connection: connectionOf(d.state()),
      armed: d.state().recovery.armed,
      named: status.message.includes('another tab or device'),
      retry: status.retry,
      refreshed: d.count('refresh-view'),
    },
    expected: {
      connection: 'unavailable',
      armed: null,
      named: true,
      retry: true,
      refreshed: 1,
    },
  });
});

test('mute follows success only, and a failed change stops only the microphone', () => {
  const d = driver();
  d.join(['camera', 'microphone']);
  d.send({ type: 'mute-requested', muted: true });
  const changing = d.state().changingMicrophone;
  d.room({ type: 'mute-applied', muted: true });
  const remembered = d.effects.filter(
    (effect) => effect.type === 'remember-mute',
  );
  d.send({ type: 'mute-requested', muted: false });
  d.room({ type: 'mute-failed', kind: 'failure' });
  assert({
    given: 'a mute that applies, then an unmute that fails',
    should:
      'remember the success, keep the old choice after the failure, and stop only the microphone',
    actual: {
      changing,
      remembered,
      muted: d.state().microphoneMuted,
      microphone: d.live().sources.microphone.phase,
      camera: d.live().sources.camera.phase,
    },
    expected: {
      changing: true,
      remembered: [{ type: 'remember-mute', muted: true }],
      muted: true,
      microphone: 'failed',
      camera: 'published',
    },
  });
});

test('losing the tab releases everything and comes back on a new connection', () => {
  const d = driver();
  d.join(['camera']);
  d.send({ type: 'tab-changed', owns: false });
  const away = [d.count('release-connection'), statusOf(d.state()).retry];
  d.send({
    type: 'read-requested',
    read: { kind: 'view', roundViewVersion: 7 },
  });
  d.send({ type: 'tab-changed', owns: true });
  assert({
    given:
      'the tab stepping down, a newer view while away, and the claim returning',
    should: 'release, remember the newest view, and admit afresh',
    actual: [away, d.state().intent.roundViewVersion, d.count('admit')],
    expected: [[1, false], 7, 1],
  });
});

test('only the round ending forgets the mute choice', () => {
  const ended = driver();
  ended.join();
  ended.send({ type: 'round-ended' });
  const left = driver();
  left.join();
  left.send({ type: 'page-left' });
  assert({
    given: 'a round that ended, and a page that left',
    should: 'forget the choice for the first only',
    actual: [ended.count('forget-mute'), left.count('forget-mute')],
    expected: [1, 0],
  });
});

test('a read let finish spends no attempt after its retry pause', () => {
  const d = driver();
  d.join();
  d.send({ type: 'read-requested', read: { kind: 'wake' } });
  d.flushDeferred();
  d.send({ type: 'read-failed', ticket: d.ticket(), failure: 'transient' });
  const before = d.count('start-read');
  d.send({
    type: 'read-requested',
    read: { kind: 'view', roundViewVersion: 2 },
  });
  d.flushDeferred();
  assert({
    given: 'a read paused between attempts when a newer view arrives',
    should: 'drop the pause and read fresh, with one read in flight',
    actual: [d.count('start-read') - before, d.live().reads.flight?.attempt],
    expected: [1, 0],
  });
});
