import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { stepFromPointer } from './step-from-pointer';

setupRitewayBun();

const plot = { left: 40, right: 406 };

describe('stepFromPointer', () => {
  test('maps a pointer onto a debate', () => {
    const box = { left: 100, width: 420 };
    assert({
      given: 'a 420-wide chart drawn at its natural size, ten debates',
      should: 'give 0 at the left margin, 10 at the right and clamp outside',
      actual: [140, 323, 506, 0, 900].map((x) =>
        stepFromPointer(x, box, plot, 420, 10),
      ),
      expected: [0, 5, 10, 0, 10],
    });
  });

  test('degenerate input', () => {
    assert({
      given: 'a zero-width box or a single-point series',
      should: 'stay at step 0',
      actual: [
        stepFromPointer(5, { left: 0, width: 0 }, plot, 420, 10),
        stepFromPointer(5, { left: 0, width: 420 }, plot, 420, 0),
      ],
      expected: [0, 0],
    });
  });
});
