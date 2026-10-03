import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { postedForm } from '../../lib/testing/posted-form';
import { createdRoomPath, parseCreateRoom, parseTimings } from './settings';

setupRitewayBun();

const valid = {
  name: 'Tuesday practice',
  format: 'foundation',
  speech: '4',
  prep: '2',
  judge: 'person',
};

describe('parseCreateRoom', () => {
  test('a valid room', () => {
    assert({
      given: 'a named room with timings and a person judge',
      should: 'accept it with the numbers read as numbers',
      actual: parseCreateRoom(postedForm(valid)),
      expected: {
        ok: true,
        value: {
          name: 'Tuesday practice',
          speech: 4,
          prep: 2,
          judge: 'person',
        },
      },
    });
  });

  test('no name is fine', () => {
    assert({
      given: 'a room with no name',
      should: 'accept it with an empty name',
      actual: parseCreateRoom(postedForm({ ...valid, name: '' })).ok,
      expected: true,
    });
  });

  test('each refusal', () => {
    const refusals = [
      { name: 'x'.repeat(61) },
      { format: 'ipda' },
      { speech: '7' },
      { prep: '9' },
      { judge: 'robot' },
    ].map((change) => {
      const result = parseCreateRoom(postedForm({ ...valid, ...change }));
      return result.ok ? null : result.error;
    });
    assert({
      given: 'a long name, an unknown format, bad timings and an unknown judge',
      should: 'refuse each with its own message',
      actual: refusals,
      expected: [
        'A room name is up to 60 characters.',
        'Choose a format.',
        'Choose a speech length of 2, 3, 4, 5 or 8 minutes.',
        'Choose a prep time of 0, 1, 2 or 3 minutes.',
        'Choose who judges: a person or the AI judge.',
      ],
    });
  });
});

describe('parseTimings', () => {
  test('timings alone', () => {
    assert({
      given: 'a speech and prep length',
      should: 'accept them',
      actual: parseTimings(postedForm({ speech: '8', prep: '0' })),
      expected: { ok: true, value: { speech: 8, prep: 0 } },
    });
  });
});

describe('createdRoomPath', () => {
  test('by judge', () => {
    const room = { name: '', speech: 4, prep: 2 } as const;
    assert({
      given: 'a person judge and the AI judge',
      should: 'open the matching room',
      actual: [
        createdRoomPath({ ...room, judge: 'person' }),
        createdRoomPath({ ...room, judge: 'ai' }),
      ],
      expected: ['/rooms/created', '/rooms/created-ai'],
    });
  });
});
