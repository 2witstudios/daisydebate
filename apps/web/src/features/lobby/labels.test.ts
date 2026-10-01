import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { bandLabel, modeLabel, rulesLabel, statusLabel } from './labels';
import { NOW, liveRoom, openRoom } from './room.test-support';

setupRitewayBun();

const waited = (minutes: number) =>
  new Date(Date.parse(NOW) - minutes * 60_000).toISOString();

describe('bandLabel', () => {
  test('each band shape', () => {
    assert({
      given: 'bounded, half-open and unbounded bands',
      should: 'describe each the way the lobby shows it',
      actual: [
        bandLabel({ min: 1300, max: 1700 }),
        bandLabel({ min: 1600, max: null }),
        bandLabel({ min: null, max: 1400 }),
        bandLabel({ min: null, max: null }),
      ],
      expected: ['1300–1700', '1600+', 'up to 1400', 'any rating'],
    });
  });
});

describe('statusLabel', () => {
  test('an open table', () => {
    assert({
      given: 'tables that waited 0, 2 and 75 minutes',
      should: 'show minutes, at least 1, then hours',
      actual: [0, 2, 75].map((minutes) =>
        statusLabel(openRoom({ waitingSince: waited(minutes) }), NOW),
      ),
      expected: ['Waiting 1 min', 'Waiting 2 min', 'Waiting 1 h'],
    });
  });

  test('a live room', () => {
    assert({
      given: 'a room watched by 14',
      should: 'show the audience',
      actual: statusLabel(liveRoom({ watching: 14 }), NOW),
      expected: '14 watching',
    });
  });
});

describe('room labels', () => {
  test('mode and rules', () => {
    assert({
      given: 'ranked and custom-rule casual rooms',
      should: 'name mode and rules',
      actual: [
        modeLabel(openRoom({ mode: 'ranked' })),
        modeLabel(openRoom({ mode: 'casual' })),
        rulesLabel(openRoom({ customRules: false })),
        rulesLabel(openRoom({ mode: 'casual', customRules: true })),
      ],
      expected: ['Ranked', 'Casual', 'Standard rules', 'Custom rules'],
    });
  });
});
