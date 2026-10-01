import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { rangeBars } from './explainer';

setupRitewayBun();

describe('rangeBars', () => {
  test('a wide provisional range and a narrow established one', () => {
    const [provisional, established] = rangeBars(400);
    assert({
      given: 'a 400-unit chart',
      should:
        'span 1110–1790 (44–316) for the provisional and 1510–1730 (204–292) for the established',
      actual: [provisional, established],
      expected: [
        {
          key: 'provisional',
          label: 'Provisional',
          x1: 44,
          x2: 316,
          dot: 180,
          y: 20,
        },
        {
          key: 'established',
          label: 'Established',
          x1: 204,
          x2: 292,
          dot: 248,
          y: 56,
        },
      ],
    });
  });
});
