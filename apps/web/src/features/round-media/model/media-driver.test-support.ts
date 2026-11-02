import { admission, snapshot } from '../media-fixtures.test-support';
import type { MediaEffect, MediaTimer } from './media-effects';
import type { MediaEvent } from './media-events';
import {
  initialMediaState,
  type LiveConnection,
  type MediaState,
  type Source,
} from './media-state';
import { answerWith, testPolicy } from './media-state.test-support';
import { reduceMedia } from './reduce-media';

/** What recovery is waiting to do, which the link now says for itself. */
export const armedOf = ({ link }: MediaState) => {
  if (link.phase === 'released' && link.why === 'transient') return 'rejoin';
  return link.phase === 'live' &&
    link.establishment.stage === 'established' &&
    link.establishment.freshness.status === 'stale' &&
    link.establishment.freshness.cause === 'transient' &&
    link.establishment.freshness.wakeArmed
    ? 'wake'
    : null;
};
export const answerOf = ({ establishment }: LiveConnection) =>
  establishment.stage === 'established' ? establishment : null;

/** Runs events through the pure reducer and keeps what each asked of the world. */
export const driver = (start?: MediaState) => {
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
    /** Fires the current schedule of this timer, as the runtime would. */
    timer: (timer: MediaTimer) =>
      send({ type: 'timer-fired', timer, id: state.timers[timer] ?? 0 }),
    scheduled: (timer: MediaTimer) =>
      effects.flatMap((effect) =>
        effect.type === 'schedule' && effect.timer === timer ? [effect.ms] : [],
      ),
  };
};

/** One state of every phase and shape the reducer can hold. */
export const everyState = (): readonly (readonly [string, MediaState])[] => {
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
    [
      'admission pausing',
      at((d) => {
        d.send({ type: 'tab-changed', owns: true });
        d.send({
          type: 'admission-failed',
          connection: (d.state().link as { connection: number }).connection,
          failure: 'transient',
        });
      }),
    ],
    [
      'rejoin admitting',
      at((d) => {
        d.join();
        d.room({ type: 'dropped' });
        d.timer('recovery');
      }),
    ],
    [
      'first read pausing',
      at((d) => {
        connecting(d);
        d.room({ type: 'connected', permission: null });
        d.send({
          type: 'read-failed',
          ticket: d.ticket(),
          failure: 'transient',
        });
      }),
    ],
    [
      'read starting',
      at((d) => {
        d.join();
        d.send({ type: 'read-requested', read: { kind: 'wake' } });
      }),
    ],
    [
      'read in flight, another wanted',
      at((d) => {
        d.join();
        d.send({ type: 'read-requested', read: { kind: 'wake' } });
        d.flushDeferred();
        d.send({ type: 'read-requested', read: { kind: 'wake' } });
      }),
    ],
    [
      'read aborting, checking',
      at((d) => {
        d.join();
        d.send({ type: 'read-requested', read: { kind: 'wake' } });
        d.flushDeferred();
        d.send({
          type: 'read-requested',
          read: { kind: 'view', roundViewVersion: 2 },
        });
      }),
    ],
    [
      'read letting finish',
      at((d) => {
        d.join();
        d.send({ type: 'read-requested', read: { kind: 'wake' } });
        d.flushDeferred();
        d.send({
          type: 'read-requested',
          read: { kind: 'view', roundViewVersion: 2 },
        });
        d.send({ type: 'read-aborted', ticket: d.ticket() });
        d.flushDeferred();
        d.send({
          type: 'read-requested',
          read: { kind: 'view', roundViewVersion: 3 },
        });
      }),
    ],
    [
      'prompt past patience',
      at((d) => {
        d.join();
        d.send({ type: 'read-requested', read: { kind: 'wake' } });
        d.flushDeferred();
        d.answer(['camera']);
        d.timer('capture-patience');
      }),
    ],
    [
      'answer waiting behind an apply',
      at((d) => {
        d.join();
        d.send({ type: 'read-requested', read: { kind: 'wake' } });
        d.flushDeferred();
        d.answer(['camera']);
        d.room({ type: 'captured', source: 'camera' });
        d.send({
          type: 'read-requested',
          read: { kind: 'view', roundViewVersion: 2 },
        });
        d.flushDeferred();
        d.answer(['camera']);
      }),
    ],
    ['warm microphone', at((d) => d.join(['camera']))],
    [
      'unpublishing',
      at((d) => {
        d.join(['camera']);
        d.room({ type: 'permission-changed', permission: [] });
      }),
    ],
    [
      'failed and still removing',
      at((d) => {
        d.join(['camera']);
        d.room({ type: 'track-ended', source: 'camera' });
      }),
    ],
    [
      'failed',
      at((d) => {
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
      }),
    ],
    [
      'missing',
      at((d) => {
        d.join();
        d.send({ type: 'read-requested', read: { kind: 'wake' } });
        d.flushDeferred();
        d.answer(['camera']);
        d.room({
          type: 'capture-failed',
          source: 'camera',
          kind: 'absence',
          checked: true,
        });
      }),
    ],
    [
      'stale publication',
      at((d) => {
        d.join(['camera']);
        d.room({ type: 'permission-changed', permission: [] });
        d.room({ type: 'unpublish-failed', source: 'camera' });
      }),
    ],
    [
      'published on a swapped device',
      at((d) => {
        d.join(['camera']);
        d.room({ type: 'device-swapped', source: 'camera' });
      }),
    ],
    [
      'mute in flight',
      at((d) => {
        d.join(['microphone']);
        d.send({ type: 'mute-requested', muted: true });
      }),
    ],
    [
      'stale, its wake waiting',
      at((d) => {
        d.join();
        d.send({
          type: 'read-requested',
          read: { kind: 'view', roundViewVersion: 2 },
        });
        d.timer('read-budget');
      }),
    ],
    [
      'defaults chosen',
      at((d) => {
        d.join();
        d.send({ type: 'read-requested', read: { kind: 'wake' } });
        d.flushDeferred();
        d.answer(['camera']);
        d.room({
          type: 'capture-failed',
          source: 'camera',
          kind: 'preference-unreadable',
          checked: false,
        });
        d.send({ type: 'retry-pressed' });
      }),
    ],
    [
      'stuck publish beside a live microphone',
      at((d) => {
        d.join(['microphone']);
        d.send({ type: 'read-requested', read: { kind: 'wake' } });
        d.flushDeferred();
        d.answer(['camera', 'microphone']);
        d.room({ type: 'captured', source: 'camera' });
        d.timer('read-budget');
      }),
    ],
    [
      'stuck publish with nothing healthy',
      at((d) => {
        d.join([]);
        d.send({ type: 'read-requested', read: { kind: 'wake' } });
        d.flushDeferred();
        d.answer(['camera', 'microphone']);
        d.room({ type: 'captured', source: 'camera' });
        d.room({
          type: 'capture-failed',
          source: 'microphone',
          kind: 'permission',
          checked: false,
        });
        d.timer('read-budget');
      }),
    ],
    [
      'stuck publish, nothing published, reception live',
      at((d) => {
        d.join();
        d.room({
          type: 'observed',
          tracks: [
            {
              identity: 'peer',
              source: 'microphone',
              local: false,
              speaking: false,
              muted: false,
            },
          ],
          peers: [],
        });
        d.send({ type: 'read-requested', read: { kind: 'wake' } });
        d.flushDeferred();
        d.answer(['camera']);
        d.room({ type: 'captured', source: 'camera' });
        d.room({
          type: 'capture-failed',
          source: 'microphone',
          kind: 'permission',
          checked: false,
        });
        d.timer('read-budget');
      }),
    ],
    ['ended', at((d) => d.send({ type: 'page-left' }))],
  ];
};

export const everyEvent = (
  connection: number,
  ticket: number,
  timers: MediaState['timers'] = {},
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
    ).map((timer): MediaEvent => ({
      type: 'timer-fired',
      timer,
      id: timers[timer] ?? 999,
    })),
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
    room({ type: 'mute-abandoned' }),
    room({ type: 'mute-failed', kind: 'failure' }),
    room({ type: 'playback-changed', allowed: false }),
  ];
};

export const ctx = { atMs: 2_000_000, policy: testPolicy };
