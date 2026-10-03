import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  applyAction,
  createdState,
  filled,
  mySeat,
  parseRoomState,
  presetFor,
  roomHref,
  settingsSaved,
  startBlock,
  type RoomState,
} from './state';

setupRitewayBun();

const take = (state: RoomState, seat: 'affirmative' | 'negative' | 'judge') =>
  applyAction(state, { kind: 'take', seat });

describe('presetFor', () => {
  test('a created room', () => {
    assert({
      given: 'the room a visitor just created',
      should: 'be open, hosted by the viewer, with every seat empty',
      actual: [
        presetFor('created').role,
        presetFor('created').lifecycle,
        mySeat(presetFor('created')),
      ],
      expected: ['host', 'open', null],
    });
  });

  test('the other sample rooms', () => {
    assert({
      given: 'a rematch, a started room, a closed room and a private room',
      should: 'reopen, start, close and refuse as each name says',
      actual: [
        presetFor('rematch').reopened,
        presetFor('started').lifecycle,
        presetFor('closed').lifecycle,
        presetFor('private').role,
      ],
      expected: [true, 'started', 'closed', 'outsider'],
    });
  });
});

describe('parseRoomState and roomHref', () => {
  test('round trip', () => {
    const state = take(presetFor('needs-judge'), 'negative');
    const href = roomHref('needs-judge', state);
    const params = Object.fromEntries(new URL(href, 'https://x').searchParams);
    assert({
      given: 'a state written to an address and read back',
      should: 'give the same state, without a preset reapplying',
      actual: parseRoomState('needs-judge', params),
      expected: state,
    });
  });

  test('a hand-edited address', () => {
    assert({
      given: 'nonsense in every field',
      should: 'fall back to the room’s preset',
      actual: parseRoomState('created', {
        aff: 'x',
        neg: ['y'],
        judge: '1',
        kind: 'robot',
        state: 'gone',
        as: 'admin',
      }),
      expected: createdState,
    });
  });
});

describe('applyAction', () => {
  test('take a free seat', () => {
    const next = take(presetFor('created'), 'affirmative');
    assert({
      given: 'an empty room and a take on the affirmative',
      should: 'seat the viewer there',
      actual: mySeat(next),
      expected: 'affirmative',
    });
  });

  test('a taken seat', () => {
    const next = take(presetFor('needs-judge'), 'affirmative');
    assert({
      given: 'the affirmative already held by someone else',
      should: 'refuse and say the seat is taken, changing nothing else',
      actual: [next.affirmative, next.notice],
      expected: ['them', 'seat-taken'],
    });
  });

  test('moving seats clears readiness', () => {
    const ready = applyAction(take(presetFor('created'), 'affirmative'), {
      kind: 'ready',
    });
    const moved = take(ready, 'negative');
    assert({
      given: 'a ready viewer who moves to the other side',
      should: 'hold the new seat, free the old one and drop every ready flag',
      actual: [moved.affirmative, moved.negative, moved.ready],
      expected: ['empty', 'you', []],
    });
  });

  test('leaving', () => {
    const next = applyAction(take(presetFor('created'), 'judge'), {
      kind: 'leave',
    });
    assert({
      given: 'a viewer who holds the judge seat and leaves',
      should: 'free the seat',
      actual: next.judge,
      expected: 'empty',
    });
  });

  test('the ready toggle', () => {
    const seated = take(presetFor('created'), 'affirmative');
    const on = applyAction(seated, { kind: 'ready' });
    const off = applyAction(on, { kind: 'ready' });
    assert({
      given: 'a seated viewer toggling ready twice',
      should: 'turn it on, then off',
      actual: [on.ready, off.ready],
      expected: [['affirmative'], []],
    });
  });

  test('ready with Redis down', () => {
    const seated = take(presetFor('created'), 'affirmative');
    const down = applyAction(seated, { kind: 'demo', what: 'redis-down' });
    assert({
      given: 'a seated viewer while ready status is unavailable',
      should: 'change nothing and report the room as blocked',
      actual: [applyAction(down, { kind: 'ready' }).ready, startBlock(down)],
      expected: [[], 'Both debater seats must be filled.'],
    });
  });

  test('switching to the AI judge', () => {
    const person = take(presetFor('created'), 'judge');
    const ai = applyAction(person, { kind: 'judge-kind', judgeKind: 'ai' });
    assert({
      given:
        'a person holding the judge seat and the host choosing the AI judge',
      should: 'remove the person and count the seat as filled',
      actual: [ai.judge, ai.judgeKind, filled(ai, 'judge')],
      expected: ['empty', 'ai', true],
    });
  });

  test('a person cannot take the judge seat while the AI judges', () => {
    const ai = presetFor('ai-judge');
    assert({
      given: 'a room judged by the AI judge',
      should: 'refuse a person at the judge seat',
      actual: [take(ai, 'judge').judge, take(ai, 'judge').notice],
      expected: ['empty', 'seat-taken'],
    });
  });
});

describe('startBlock', () => {
  const everyone = (state: RoomState) =>
    applyAction(state, { kind: 'demo', what: 'everyone-ready' });

  test('walking a room to a start', () => {
    const steps: RoomState[] = [];
    let state = presetFor('created');
    steps.push(state);
    state = take(state, 'affirmative');
    steps.push(state);
    state = applyAction(state, { kind: 'demo', what: 'opponent-joins' });
    steps.push(state);
    state = applyAction(state, { kind: 'demo', what: 'judge-joins' });
    steps.push(state);
    state = applyAction(state, { kind: 'ready' });
    steps.push(state);
    state = everyone(state);
    steps.push(state);
    assert({
      given: 'a room filled step by step and then readied',
      should: 'name what blocks the start until everyone is ready',
      actual: steps.map(startBlock),
      expected: [
        'Both debater seats must be filled.',
        'Both debater seats must be filled.',
        'A judge must take the judge seat.',
        'Everyone seated must be ready.',
        'Everyone seated must be ready.',
        null,
      ],
    });
  });

  test('the AI judge needs no ready flag', () => {
    const state = everyone({
      ...presetFor('ai-judge'),
      affirmative: 'you',
      negative: 'them',
    });
    assert({
      given: 'two readied debaters and an AI judge',
      should: 'be ready to start with no judge flag',
      actual: [startBlock(state), state.ready.includes('judge')],
      expected: [null, false],
    });
  });

  test('a settings change clears readiness', () => {
    const state = everyone({
      ...presetFor('ai-judge'),
      affirmative: 'you',
      negative: 'them',
    });
    assert({
      given: 'a ready room whose host saves settings',
      should: 'drop every ready flag and say the settings were saved',
      actual: [settingsSaved(state).ready, settingsSaved(state).notice],
      expected: [[], 'settings-saved'],
    });
  });
});
