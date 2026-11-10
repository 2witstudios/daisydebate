import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  stageConnectionIdle,
  stageConnectionOn,
  stageLinkOf,
  type StageConnection,
  type StageConnectionEvent,
} from './stage-connection';

setupRitewayBun();

const roomA = { name: 'a' };
const roomB = { name: 'b' };
const replay = (
  events: readonly StageConnectionEvent<{ name: string }>[],
  from: StageConnection<{ name: string }> = stageConnectionIdle,
) =>
  events.reduce(
    (step, event) => {
      const next = stageConnectionOn(step.state, event);
      return {
        state: next.state,
        disconnects: [
          ...step.disconnects,
          ...next.effects.map((effect) => effect.room.name),
        ],
      };
    },
    { state: from, disconnects: [] as string[] },
  );

describe('stageConnectionOn', () => {
  test('a join from no room joins, and its connect joins the room', () => {
    assert({
      given: 'join(a) then joined(a)',
      should: 'hold room a joined and not resuming, with nothing to disconnect',
      actual: replay([
        { type: 'join', room: roomA },
        { type: 'joined', room: roomA },
      ]),
      expected: {
        state: { kind: 'joined', room: roomA, resuming: false },
        disconnects: [],
      },
    });
  });
  test('a failed connect drops the room so the next poll can retry', () => {
    assert({
      given: 'join(a) then failed(a)',
      should: 'return to no room and disconnect a',
      actual: replay([
        { type: 'join', room: roomA },
        { type: 'failed', room: roomA },
      ]),
      expected: { state: stageConnectionIdle, disconnects: ['a'] },
    });
  });
  test('a join while a room is joining or joined changes nothing', () => {
    assert({
      given: 'join(b) while joining a, and while joined to a',
      should: 'keep room a and disconnect b, which never connects',
      actual: [
        replay([
          { type: 'join', room: roomA },
          { type: 'join', room: roomB },
        ]),
        replay([
          { type: 'join', room: roomA },
          { type: 'joined', room: roomA },
          { type: 'join', room: roomB },
        ]).state,
      ],
      expected: [
        { state: { kind: 'joining', room: roomA }, disconnects: ['b'] },
        { kind: 'joined', room: roomA, resuming: false },
      ],
    });
  });
  test('a stale room cannot move the current one', () => {
    assert({
      given:
        'joined(b), failed(b), dropped(b) and resuming(b) while room a holds',
      should: 'keep room a, disconnecting b where it answered',
      actual: replay([
        { type: 'join', room: roomA },
        { type: 'joined', room: roomB },
        { type: 'failed', room: roomB },
        { type: 'dropped', room: roomB },
        { type: 'resuming', room: roomB },
      ]),
      expected: {
        state: { kind: 'joining', room: roomA },
        disconnects: ['b', 'b'],
      },
    });
  });
  test('a joined room that resumes, resumes or drops', () => {
    const joined = replay([
      { type: 'join', room: roomA },
      { type: 'joined', room: roomA },
    ]).state;
    assert({
      given: 'resuming(a), then resumed(a); and dropped(a)',
      should: 'mark it resuming and back, and return to no room on a drop',
      actual: [
        replay([{ type: 'resuming', room: roomA }], joined).state,
        replay(
          [
            { type: 'resuming', room: roomA },
            { type: 'resumed', room: roomA },
          ],
          joined,
        ).state,
        replay([{ type: 'dropped', room: roomA }], joined),
      ],
      expected: [
        { kind: 'joined', room: roomA, resuming: true },
        { kind: 'joined', room: roomA, resuming: false },
        { state: stageConnectionIdle, disconnects: [] },
      ],
    });
  });
  test('closing ends the connection for good', () => {
    assert({
      given: 'close while joining a, then joined(a) and join(b)',
      should: 'stay closed and disconnect a twice and b once',
      actual: replay([
        { type: 'join', room: roomA },
        { type: 'close' },
        { type: 'joined', room: roomA },
        { type: 'join', room: roomB },
        { type: 'failed', room: roomA },
      ]),
      expected: {
        state: { kind: 'closed' },
        disconnects: ['a', 'a', 'b', 'a'],
      },
    });
  });
});

describe('stageLinkOf', () => {
  test('only a joined room that is not resuming is connected', () => {
    assert({
      given: 'each kind of connection',
      should: 'say connected only for a settled joined room',
      actual: (
        [
          stageConnectionIdle,
          { kind: 'joining', room: roomA },
          { kind: 'joined', room: roomA, resuming: false },
          { kind: 'joined', room: roomA, resuming: true },
          { kind: 'closed' },
        ] as const
      ).map((state) => stageLinkOf(state)),
      expected: [
        'reconnecting',
        'reconnecting',
        'connected',
        'reconnecting',
        'reconnecting',
      ],
    });
  });
});
