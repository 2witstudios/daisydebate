import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  nextConnectionPhase,
  terminalReason,
  type ConnectionEvent,
  type ConnectionPhase,
} from './connection-status';

setupRitewayBun();

const phases = {
  idle: { status: 'idle' },
  ticketing: { status: 'ticketing' },
  handshaking: { status: 'handshaking' },
  open: { status: 'open' },
  reconnecting: { status: 'reconnecting' },
  'closed(left)': { status: 'closed', why: 'left' },
  'closed(disposed)': { status: 'closed', why: 'disposed' },
  'closed(revoked)': { status: 'closed', why: 'revoked' },
  'closed(unsupported)': { status: 'closed', why: 'unsupported' },
  'closed(signed-out)': { status: 'closed', why: 'signed-out' },
} as const satisfies Record<string, ConnectionPhase>;
type PhaseName = keyof typeof phases;

const events = {
  'connect-asked': { type: 'connect-asked' },
  'hello-sent': { type: 'hello-sent' },
  ready: { type: 'ready' },
  'socket-closed(retry)': { type: 'socket-closed', terminal: null },
  'socket-closed(revoked)': { type: 'socket-closed', terminal: 'revoked' },
  'socket-closed(unsupported)': {
    type: 'socket-closed',
    terminal: 'unsupported',
  },
  'socket-closed(signed-out)': {
    type: 'socket-closed',
    terminal: 'signed-out',
  },
  'socket-reaped': { type: 'socket-reaped' },
  left: { type: 'left' },
  disposed: { type: 'disposed' },
} as const satisfies Record<string, ConnectionEvent>;
type EventName = keyof typeof events;

const nameOf = (phase: ConnectionPhase): string =>
  phase.status === 'closed' ? `closed(${phase.why})` : phase.status;

const socketCloses = {
  'socket-closed(retry)': 'reconnecting',
  'socket-closed(revoked)': 'closed(revoked)',
  'socket-closed(unsupported)': 'closed(unsupported)',
  'socket-closed(signed-out)': 'closed(signed-out)',
} as const;
const ends = { left: 'closed(left)', disposed: 'closed(disposed)' } as const;
const down = { 'connect-asked': 'ticketing', ...ends } as const;

/** Every event that moves each phase; an event not listed changes nothing. */
const TRANSITIONS: Record<PhaseName, Partial<Record<EventName, PhaseName>>> = {
  idle: down,
  ticketing: { 'hello-sent': 'handshaking', ...socketCloses, ...ends },
  handshaking: { ready: 'open', ...socketCloses, ...ends },
  open: { ...socketCloses, 'socket-reaped': 'reconnecting', ...ends },
  reconnecting: down,
  'closed(left)': {
    'connect-asked': 'ticketing',
    disposed: 'closed(disposed)',
  },
  'closed(disposed)': {},
  'closed(revoked)': down,
  'closed(unsupported)': down,
  'closed(signed-out)': down,
};

const names = <K extends string>(record: Record<K, unknown>) =>
  Object.keys(record) as K[];

for (const name of names(phases))
  test(`every event in the phase "${name}"`, () => {
    const moved: Partial<Record<EventName, string>> = {};
    for (const event of names(events)) {
      const next = nextConnectionPhase(phases[name], events[event]);
      if (next !== phases[name]) moved[event] = nameOf(next);
    }
    assert({
      given: `the phase "${name}" and every event`,
      should: 'move as the table says and return the same phase otherwise',
      actual: moved,
      expected: TRANSITIONS[name],
    });
  });

test('the table covers every phase', () => {
  assert({
    given: 'the phases the table lists and the phases a connection can be in',
    should: 'be the same phases',
    actual: names(TRANSITIONS).sort(),
    expected: names(phases).sort(),
  });
});

test('every event in every phase yields a known phase', () => {
  const unknown: string[] = [];
  for (const name of names(phases))
    for (const event of names(events)) {
      const next = nameOf(nextConnectionPhase(phases[name], events[event]));
      if (!(next in phases)) unknown.push(`${name} + ${event} -> ${next}`);
    }
  assert({
    given: 'every phase and every event',
    should: 'never leave the listed phases',
    actual: unknown,
    expected: [],
  });
});

/** A seeded generator, so the random walks below replay exactly. */
const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

/**
 * Open is reached only through ready, a retry is scheduled only for a socket
 * that was up, and nothing leaves disposal.
 */
const brokenRule = (from: string, event: EventName, to: string) => {
  if (from === to) return null;
  if (to === 'open' && event !== 'ready') return 'opened without ready';
  if (
    to === 'reconnecting' &&
    !['ticketing', 'handshaking', 'open'].includes(from)
  )
    return 'retried with no socket lost';
  return from === 'closed(disposed)' ? 'left disposal' : null;
};

test('random event sequences keep the connection honest', () => {
  const broken: string[] = [];
  const all = names(events);
  for (let seed = 1; seed <= 200; seed++) {
    const random = seeded(seed);
    let phase: ConnectionPhase = phases.idle;
    for (let step = 0; step < 60; step++) {
      const event = all[Math.floor(random() * all.length)]!;
      const next = nextConnectionPhase(phase, events[event]);
      const rule = brokenRule(nameOf(phase), event, nameOf(next));
      if (rule) broken.push(`${nameOf(phase)} + ${event}: ${rule}`);
      phase = next;
    }
  }
  assert({
    given: '200 seeded walks of 60 random events from idle',
    should: 'break no rule',
    actual: broken,
    expected: [],
  });
});

test('only a server verdict is a terminal reason', () => {
  assert({
    given: 'every phase',
    should: 'name a reason only where the server forbade retrying',
    actual: names(phases).map((name) => terminalReason(phases[name])),
    expected: [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      'revoked',
      'unsupported',
      'signed-out',
    ],
  });
});
