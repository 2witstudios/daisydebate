import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { RoundRatings } from '../ui/ranked/round-ratings';

setupRitewayBun();

const row = {
  label: 'maya.okafor',
  rating: 1526,
  provisional: false,
  delta: 14,
  win: 14,
  loss: -12,
};

/**
 * A rating change is toned by colour alone (green for a gain, clay for a
 * loss) beside its signed figure; the tone has no role, name or state.
 */
describe('RoundRatings markup', () => {
  test('change tones', () => {
    const html = renderMarkup(
      <RoundRatings
        view={{
          ladder: { style: 'freestyle', division: 'youth' },
          season: 'Fall 2026',
          posting: 'rated',
          rows: [
            row,
            {
              ...row,
              label: 'jules_park',
              rating: 1466,
              provisional: true,
              delta: -12,
              win: 16,
            },
          ],
        }}
      />,
    );
    assert({
      given: 'a rated Round with a gain and a provisional loss',
      should: 'set each change beside its rating in its tone',
      actual: [
        html.includes(
          '1526<span class="font-body text-base font-book not-italic text-online"> +14</span>',
        ),
        html.includes(
          '1466*<span class="font-body text-base font-book not-italic text-hue-clay"> −12</span>',
        ),
      ],
      expected: [true, true],
    });
  });
});
