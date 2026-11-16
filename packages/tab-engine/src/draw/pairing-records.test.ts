import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { pairingRecords } from '../index';
import {
  baseSettings,
  bye,
  debate,
  entry,
  inputOf,
  twoSides,
  fourSides,
  speakers,
} from '../standings/build.test-support';
setupRitewayBun();
describe('pairing records', () => {
  test('the pairing coordinate retains its exact public fraction', () => {
    const input = inputOf(
      twoSides,
      [entry('A')],
      [
        bye('b', 1, 'A', { rule: 'own_average' }),
        debate('w', 2, ['A', 'B'], 'A'),
        debate('l', 3, ['C', 'A'], 'C'),
      ],
      { ...baseSettings, 'bye.result': { value: 'own_average' } },
    );
    const record = pairingRecords(input, input.seed, 3);
    assert({
      given: 'one own-average bye and one win from two played games',
      should:
        'name the actual wins record and preserve 3/2 while pairing uses the unchanged scaled 3',
      actual: record,
      expected: {
        label: 'Wins',
        entries: [{ entry: 'A', value: { n: 3, d: 2 }, scaled: 3 }],
      },
    });
  });
  test('format records before any result', () => {
    assert({
      given: 'two-side, four-side and speaker formats at cutoff zero',
      should: 'name only the record the pairing engine actually uses',
      actual: [twoSides, fourSides, speakers].map((format) => {
        const input = inputOf(format, [entry('A')], [], baseSettings);
        return pairingRecords(input, input.seed, 0);
      }),
      expected: ['Wins', 'Team points', 'Record'].map((label) => ({
        label,
        entries: [{ entry: 'A', value: { n: 0, d: 1 }, scaled: 0 }],
      })),
    });
  });
});
