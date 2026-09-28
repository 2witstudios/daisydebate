import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  bloom,
  bloomPetals,
  opposingPetals,
  petalPath,
  type PetalShape,
} from './petal';
import { pointsOf } from './petal.test-support';

setupRitewayBun();

const shape: PetalShape = {
  length: 8,
  width: 5,
  bulb: 0.6,
  tipSharpness: 0.5,
};

/** The on-curve points: the move target and each curve's end point. */
const anchorsOf = (path: string): readonly (readonly [number, number])[] => {
  const [start, ...controls] = pointsOf(path);
  return [
    ...(start === undefined ? [] : [start]),
    ...controls.filter((_, index) => index % 3 === 2),
  ];
};

describe('petalPath', () => {
  test('draws a closed teardrop of four cubic curves', () => {
    const path = petalPath(shape, { tip: [12, 9], angle: 0 });
    assert({
      given: 'a petal shape and a placement',
      should: 'move to the tip, draw four cubic curves, and close',
      actual: [
        path.startsWith('M12 9 C'),
        path.match(/C/g)?.length,
        path.endsWith('Z'),
      ],
      expected: [true, 4, true],
    });
  });

  test('puts the tip, the widest point and the rounded end where the shape says', () => {
    assert({
      given: 'a petal pointing up from (12, 9)',
      should:
        'reach the bulb at 60% of its length and end one length above the tip',
      actual: anchorsOf(petalPath(shape, { tip: [12, 9], angle: 0 })),
      expected: [
        [12, 9],
        [14.5, 4.2],
        [12, 1],
        [9.5, 4.2],
        [12, 9],
      ],
    });
  });

  test('rotates clockwise about its tip', () => {
    assert({
      given: 'the same petal turned 90 degrees',
      should: 'point right, with its end one length to the right of the tip',
      actual: anchorsOf(petalPath(shape, { tip: [12, 9], angle: 90 }))[2],
      expected: [20, 9],
    });
  });

  test('scales about its tip', () => {
    assert({
      given: 'a petal drawn at twice the size',
      should: 'end two lengths from the tip',
      actual: anchorsOf(
        petalPath(shape, { tip: [0, 20], angle: 0, scale: 2 }),
      )[2],
      expected: [0, 4],
    });
  });

  test('is mirror-symmetric about its axis', () => {
    const [, right, , left] = anchorsOf(
      petalPath(shape, { tip: [12, 9], angle: 0 }),
    );
    assert({
      given: 'a petal pointing up',
      should: 'place its widest points the same distance either side',
      actual: [(right?.[0] ?? 0) - 12, 12 - (left?.[0] ?? 0)],
      expected: [2.5, 2.5],
    });
  });

  test('tapers the tip as tip sharpness rises', () => {
    const firstHandle = (tipSharpness: number) =>
      pointsOf(
        petalPath({ ...shape, tipSharpness }, { tip: [0, 0], angle: 0 }),
      )[1];
    assert({
      given: 'a round tip and a fully sharp tip',
      should:
        "leave the tip sideways when round, aimed at the bulb's handle when sharp, and between the two in between",
      actual: [firstHandle(0), firstHandle(1), firstHandle(2 / 3)],
      expected: [
        [2.191, 0],
        [1.25, -1.8],
        [1.754, -1.313],
      ],
    });
  });

  test('refuses a shape it cannot draw', () => {
    assert({
      given: 'a zero length, a negative width, and a bulb past the end',
      should: 'throw rather than draw a broken petal',
      actual: [
        { ...shape, length: 0 },
        { ...shape, width: -1 },
        { ...shape, bulb: 1 },
        { ...shape, tipSharpness: 1.5 },
      ].map((bad) => {
        try {
          petalPath(bad, { tip: [0, 0], angle: 0 });
          return 'drawn';
        } catch (error) {
          return (error as Error).message;
        }
      }),
      expected: [
        'petal length must be positive',
        'petal width must be positive',
        'petal bulb must sit between 0 and 1',
        'petal tip sharpness must sit between 0 and 1',
      ],
    });
  });
});

describe('bloom', () => {
  test('spaces eight petals evenly by default', () => {
    assert({
      given: 'no count',
      should: 'return eight rotations, 45 degrees apart, starting upright',
      actual: bloom(),
      expected: [0, 45, 90, 135, 180, 225, 270, 315],
    });
  });

  test('spaces any count evenly', () => {
    assert({
      given: 'four petals',
      should: 'return the four cardinal rotations',
      actual: bloom(4),
      expected: [0, 90, 180, 270],
    });
  });

  test('refuses a count that is not a positive whole number', () => {
    assert({
      given: 'zero and a fraction',
      should: 'throw',
      actual: [0, 2.5].map((count) => {
        try {
          return bloom(count);
        } catch (error) {
          return (error as Error).message;
        }
      }),
      expected: [
        'bloom count must be a positive whole number',
        'bloom count must be a positive whole number',
      ],
    });
  });
});

describe('bloomPetals', () => {
  test('places each petal tip on a ring around the centre, turned outward', () => {
    const petals = bloomPetals(shape, { centre: 12, petalInset: 2 });
    assert({
      given: 'a bloom centred at 12 with tips 2 from the centre',
      should:
        'draw eight petals, upright first with its tip at (12, 10), the third pointing right, cardinals and diagonals alternating',
      actual: [
        petals.length,
        petals[0]?.d,
        petals[2]?.d,
        petals.map(({ cardinal }) => cardinal),
      ],
      expected: [
        8,
        petalPath(shape, { tip: [12, 10], angle: 0 }),
        petalPath(shape, { tip: [14, 12], angle: 90 }),
        [true, false, true, false, true, false, true, false],
      ],
    });
  });

  test('scales the ring and the petals about the centre', () => {
    assert({
      given: 'the same bloom at half size',
      should: 'pull the tips in to 1 from the centre and halve each petal',
      actual: bloomPetals(shape, { centre: 12, petalInset: 2 }, 0.5)[0]?.d,
      expected: petalPath(shape, { tip: [12, 11], angle: 0, scale: 0.5 }),
    });
  });
});

describe('opposingPetals', () => {
  test('faces two petals tip to tip across the centre', () => {
    const [left, right] = opposingPetals(shape, {
      centre: [24, 12],
      gap: 4,
      tilt: 0,
    });
    assert({
      given: 'two petals with a 4-unit gap and no tilt',
      should:
        'start each tip 2 units from the centre and reach outward one length',
      actual: [
        anchorsOf(left)[0],
        anchorsOf(left)[2],
        anchorsOf(right)[0],
        anchorsOf(right)[2],
      ],
      expected: [
        [22, 12],
        [14, 12],
        [26, 12],
        [34, 12],
      ],
    });
  });

  test('keeps the pair point-symmetric when tilted', () => {
    const [left, right] = opposingPetals(shape, {
      centre: [24, 12],
      gap: 4,
      tilt: 20,
    });
    const mirrored = anchorsOf(left).map(
      ([x, y]): readonly [number, number] => [
        +(48 - x).toFixed(3),
        +(24 - y).toFixed(3),
      ],
    );
    assert({
      given: 'a tilted pair',
      should: 'make each petal the other turned half a circle about the centre',
      actual: mirrored,
      expected: anchorsOf(right),
    });
  });
});
