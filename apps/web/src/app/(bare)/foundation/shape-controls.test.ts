import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { petalShape } from '../../../ui/brand/brand-geometry';
import { shapeControls, tuneShape } from './shape-controls';

setupRitewayBun();

describe('shapeControls', () => {
  test('offers the four petal parameters, each range holding the committed value', () => {
    assert({
      given: 'the brand sheet controls',
      should:
        'cover length, width, bulb position and tip sharpness around the shipped shape',
      actual: shapeControls.map(
        ({ key, min, max }) =>
          `${key}:${min <= petalShape[key] && petalShape[key] <= max}`,
      ),
      expected: ['length:true', 'width:true', 'bulb:true', 'tipSharpness:true'],
    });
  });
});

describe('tuneShape', () => {
  test('sets one parameter from a slider value', () => {
    assert({
      given: 'a new width from its slider',
      should: 'change only the width',
      actual: tuneShape(petalShape, 'width', '4'),
      expected: { ...petalShape, width: 4 },
    });
  });

  test('leaves the shape unchanged for a value outside its range or not a number', () => {
    assert({
      given: 'a bulb past its range, a negative length, and junk',
      should: 'return the same shape each time',
      actual: [
        tuneShape(petalShape, 'bulb', '1'),
        tuneShape(petalShape, 'length', '-2'),
        tuneShape(petalShape, 'tipSharpness', 'sharp'),
      ],
      expected: [petalShape, petalShape, petalShape],
    });
  });
});
