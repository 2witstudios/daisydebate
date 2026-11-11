import type { BroadcastStream } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  attemptOf,
  firstViewing,
  reduceViewing,
  type Viewing,
  type ViewingEvent,
} from './viewing';

setupRitewayBun();

const streamOf = (name: string): BroadcastStream => ({
  path: 'owned_hls',
  manifestUrl: `https://feed.daisy.invalid/live/${name}/master.m3u8`,
});
const a = streamOf('a');
const b = streamOf('b');
const ATTEMPT = 2;

const STATES: Readonly<Record<string, Viewing>> = {
  unseen: firstViewing,
  playing: { kind: 'playing', stream: a, attempt: ATTEMPT },
  finished: { kind: 'finished', stream: a, attempt: ATTEMPT },
  unplayable: { kind: 'unplayable', stream: a, attempt: ATTEMPT },
};

/** Every event, its player reports carrying the given identity. */
const everyEvent = (
  manifestUrl: string,
  attempt: number,
): Readonly<Record<string, ViewingEvent>> => ({
  'shown its stream': { kind: 'shown', stream: a },
  // The same address read again arrives as a new object.
  'shown its stream, read again': { kind: 'shown', stream: { ...a } },
  'shown another stream': { kind: 'shown', stream: b },
  finished: { kind: 'finished', player: { manifestUrl, attempt } },
  failed: { kind: 'failed', player: { manifestUrl, attempt } },
  retried: { kind: 'retried' },
});

const nameOf = (stream: BroadcastStream): string =>
  stream.manifestUrl === a.manifestUrl ? 'a' : 'b';
const shapeOf = (viewing: Viewing): string =>
  viewing.kind === 'unseen'
    ? 'unseen'
    : `${viewing.kind} ${nameOf(viewing.stream)}:${viewing.attempt}`;

/** Each state's accepted events and where they lead; an event not listed is rejected. */
const TRANSITIONS: Readonly<Record<string, Readonly<Record<string, string>>>> =
  {
    unseen: {
      'shown its stream': 'playing a:0',
      'shown its stream, read again': 'playing a:0',
      'shown another stream': 'playing b:0',
    },
    playing: {
      'shown another stream': 'playing b:2',
      finished: 'finished a:2',
      failed: 'unplayable a:2',
    },
    finished: {
      'shown another stream': 'playing b:2',
      failed: 'unplayable a:2',
    },
    unplayable: {
      'shown another stream': 'playing b:2',
      retried: 'playing a:3',
    },
  };

for (const [name, state] of Object.entries(STATES))
  test(`every event in the viewing "${name}"`, () => {
    const cells: Record<string, string> = {};
    for (const [eventName, event] of Object.entries(
      everyEvent(a.manifestUrl, ATTEMPT),
    )) {
      const next = reduceViewing(state, event);
      if (next !== state) cells[eventName] = shapeOf(next);
    }
    assert({
      given: `the viewing "${name}" and every event`,
      should: 'do what the table says, and reject what it does not list',
      actual: cells,
      expected: TRANSITIONS[name],
    });
  });

test('the table covers every kind of viewing', () => {
  const kinds: Readonly<Record<Viewing['kind'], true>> = {
    unseen: true,
    playing: true,
    finished: true,
    unplayable: true,
  };
  assert({
    given: 'the viewings the table lists and the kinds a viewing can be',
    should: 'be the same',
    actual: [
      Object.keys(TRANSITIONS).sort(),
      Object.values(STATES)
        .map((state) => state.kind)
        .sort(),
    ],
    expected: [Object.keys(kinds).sort(), Object.keys(kinds).sort()],
  });
});

test('a report from a player that is no longer the one mounted changes nothing', () => {
  const stale = [
    everyEvent(a.manifestUrl, ATTEMPT - 1),
    everyEvent(a.manifestUrl, ATTEMPT + 1),
    everyEvent(b.manifestUrl, ATTEMPT),
  ].flatMap(({ finished, failed }) => [finished!, failed!]);
  const moved: string[] = [];
  for (const [name, state] of Object.entries(STATES))
    for (const event of stale)
      if (reduceViewing(state, event) !== state)
        moved.push(`${name} + stale ${event.kind}`);
  assert({
    given:
      'every viewing, and finished and failed from an earlier attempt, a later one and another stream',
    should: 'return the same viewing each time',
    actual: moved,
    expected: [],
  });
});

/** What must hold between a viewing and the one any event leads to. */
const violations = (before: Viewing, after: Viewing): readonly string[] => {
  const bad: string[] = [];
  if (after.kind === 'unseen' && before.kind !== 'unseen')
    bad.push('a stream once seen was forgotten');
  if (attemptOf(after) < attemptOf(before)) bad.push('an attempt went back');
  const outcome = after.kind === 'finished' || after.kind === 'unplayable';
  if (outcome && before.kind === 'unseen')
    bad.push('an outcome with no player');
  if (
    outcome &&
    before.kind !== 'unseen' &&
    before.stream.manifestUrl !== after.stream.manifestUrl
  )
    bad.push("a new stream took the last one's outcome");
  return bad;
};

test('any sequence of events keeps the viewing sound', () => {
  const problems: string[] = [];
  let seed = 20261111;
  const pick = (count: number) => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return Math.floor((seed / 2 ** 32) * count);
  };
  const reached = new Set<string>();
  for (let run = 0; run < 200; run += 1) {
    let viewing: Viewing = firstViewing;
    for (let step = 0; step < 40; step += 1) {
      const events = Object.values(
        everyEvent([a, b][pick(2)]!.manifestUrl, pick(4)),
      );
      const event = events[pick(events.length)]!;
      const next = reduceViewing(viewing, event);
      for (const problem of violations(viewing, next))
        problems.push(`${shapeOf(viewing)} + ${event.kind}: ${problem}`);
      viewing = next;
      reached.add(viewing.kind);
    }
  }
  assert({
    given: 'two hundred seeded runs of forty events, current and stale',
    should: 'never break the viewing, and reach every kind of it',
    actual: { problems, reached: [...reached].sort() },
    expected: {
      problems: [],
      reached: ['finished', 'playing', 'unplayable', 'unseen'],
    },
  });
});
