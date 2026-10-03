import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { applyAction, presetFor } from './state';
import { roomView, type RoomInfo } from './view';

setupRitewayBun();

const info = (mode: 'practice' | 'ranked' = 'practice'): RoomInfo => ({
  id: 'demo',
  title: 'Newcomers welcome',
  mode,
  hostHandle: 'host-two',
  judge: 'person',
});

const room = (view: ReturnType<typeof roomView>) => {
  if (view.kind !== 'room') throw new Error('expected a room');
  return view;
};

describe('roomView', () => {
  test('an outsider', () => {
    const view = roomView(info(), presetFor('private'));
    assert({
      given: 'a viewer with no access to the room',
      should: 'refuse and offer the lobby, naming nothing about the room',
      actual: [view.kind, view.kind === 'denied' && view.lobbyHref],
      expected: ['denied', '/lobby'],
    });
  });

  test('a fresh practice room, seen by its host', () => {
    const view = room(roomView(info(), presetFor('created')));
    assert({
      given: 'a room the viewer just created',
      should:
        'show three open seats with take links, the host controls, and no start or ready control',
      actual: [
        view.modeLabel,
        view.seats.map((seat) => seat.occupant.kind),
        view.seats.map((seat) => seat.action?.label),
        view.host?.judgeChoices.map((choice) => choice.on),
        view.start,
        view.ready,
      ],
      expected: [
        'Practice',
        ['empty', 'empty', 'empty'],
        ['Take seat', 'Take seat', 'Take seat'],
        [true, false],
        null,
        null,
      ],
    });
  });

  test('a person judge is needed', () => {
    const view = room(roomView(info(), presetFor('needs-judge')));
    const judge = view.seats.find((seat) => seat.id === 'judge');
    assert({
      given:
        'a room whose judge kind is a person and whose judge seat is empty',
      should: 'show the seat open so someone can take it',
      actual: [judge?.occupant.kind, judge?.action?.label],
      expected: ['empty', 'Take seat'],
    });
  });

  test('the AI judge', () => {
    const view = room(roomView(info(), presetFor('ai-judge')));
    const judge = view.seats.find((seat) => seat.id === 'judge');
    assert({
      given: 'a room judged by the placeholder AI judge',
      should: 'seat it, offer no seat to take and need no ready flag',
      actual: [judge?.occupant.kind, judge?.action, judge?.readiness],
      expected: ['ai', null, null],
    });
  });

  test('ready status unavailable', () => {
    const seated = applyAction(presetFor('created'), {
      kind: 'take',
      seat: 'affirmative',
    });
    const down = applyAction(seated, { kind: 'demo', what: 'redis-down' });
    const view = room(roomView(info(), down));
    assert({
      given: 'a seated viewer while Redis is down',
      should: 'say ready status is unavailable and disable the ready control',
      actual: [
        view.seats[0]?.readiness,
        view.ready?.href,
        view.ready?.note?.startsWith('Ready status is unavailable'),
      ],
      expected: ['Ready status unavailable', null, true],
    });
  });

  test('a start link only when the room is startable', () => {
    let state = applyAction(presetFor('created'), {
      kind: 'take',
      seat: 'affirmative',
    });
    state = applyAction(state, { kind: 'demo', what: 'opponent-joins' });
    state = applyAction(state, { kind: 'judge-kind', judgeKind: 'ai' });
    const before = room(roomView(info(), state));
    const ready = applyAction(state, { kind: 'demo', what: 'everyone-ready' });
    const after = room(roomView(info(), ready));
    assert({
      given:
        'two debaters and the AI judge, before and after everyone is ready',
      should: 'block the start with a reason, then link to the debate',
      actual: [
        before.start?.href,
        before.start?.blockedBy,
        after.start?.blockedBy,
        after.start?.href?.startsWith('/debates/demo'),
      ],
      expected: [null, 'Everyone seated must be ready.', null, true],
    });
  });

  test('a started room', () => {
    const view = room(roomView(info(), presetFor('started')));
    assert({
      given: 'a started room',
      should: 'link to its debate and offer no seats to take',
      actual: [
        view.status.label,
        view.debateHref?.startsWith('/debates/demo'),
        view.seats.every((seat) => seat.action === null),
      ],
      expected: ['Started', true, true],
    });
  });

  test('a reopened room', () => {
    const view = room(roomView(info(), presetFor('rematch')));
    assert({
      given: 'a room reopened after a completed debate',
      should: 'say everyone has to ready up again',
      actual: [view.status.label, view.reopenedNote?.includes('ready up')],
      expected: ['Open', true],
    });
  });

  test('a closed room', () => {
    const view = room(roomView(info(), presetFor('closed')));
    assert({
      given: 'a closed room',
      should: 'be marked closed with no actions',
      actual: [
        view.closed,
        view.status.label,
        view.seats.every((seat) => seat.action === null),
        view.start,
      ],
      expected: [true, 'Closed', true, null],
    });
  });

  test('a ranked room', () => {
    const view = room(
      roomView(
        info('ranked'),
        applyAction(presetFor('created'), {
          kind: 'take',
          seat: 'affirmative',
        }),
      ),
    );
    assert({
      given: 'a ranked room',
      should:
        'have no judge seat, no host judge choice and say Daisy assigns the judge',
      actual: [
        view.modeLabel,
        view.seats.map((seat) => seat.id),
        view.host,
        view.settings.find((row) => row.label === 'Judge')?.value,
      ],
      expected: [
        'Ranked',
        ['affirmative', 'negative'],
        null,
        'Assigned by Daisy',
      ],
    });
  });
});
