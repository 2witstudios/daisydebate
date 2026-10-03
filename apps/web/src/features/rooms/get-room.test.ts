import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { getRoomInfo } from './get-room';

setupRitewayBun();

const now = '2026-10-03T12:00:00.000Z';

describe('getRoomInfo', () => {
  test('a demo room', () => {
    assert({
      given: 'the created demo room',
      should: 'be a practice room the viewer hosts',
      actual: getRoomInfo('created', now),
      expected: {
        id: 'created',
        title: 'Your practice room',
        mode: 'practice',
        hostHandle: 'you',
        judge: 'person',
      },
    });
  });

  test('a lobby room keeps the judge it was listed with', () => {
    assert({
      given: 'a person-judged table, an AI-judged one and a ranked one',
      should: 'carry person, ai and assigned',
      actual: [
        getRoomInfo('room-newcomers', now)?.judge,
        getRoomInfo('room-anything-goes', now)?.judge,
        getRoomInfo('room-tuesday-night', now)?.judge,
      ],
      expected: ['person', 'ai', 'assigned'],
    });
  });

  test('the lobby’s open tables', () => {
    assert({
      given: 'an open ranked table and an open casual table from the lobby',
      should: 'read them as a ranked room and a practice room',
      actual: [
        getRoomInfo('room-tuesday-night', now)?.mode,
        getRoomInfo('room-newcomers', now)?.mode,
      ],
      expected: ['ranked', 'practice'],
    });
  });

  test('a live debate or an unknown id', () => {
    assert({
      given: 'a live lobby row and an id nobody has',
      should: 'not be a room',
      actual: [
        getRoomInfo('room-ranked-serious', now),
        getRoomInfo('nope', now),
      ],
      expected: [null, null],
    });
  });
});
