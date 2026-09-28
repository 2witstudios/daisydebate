import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { bloom, opposingPetals, petalPath, type PetalShape } from './petal';

setupRitewayBun();

const shape: PetalShape = {
  length: 8,
  width: 5,
  bulb: 0.6,
  tipSharpness: 0.5,
};

/** Every coordinate pair the path passes through or steers by. */
const pointsOf = (path: string): readonly (readonly [number, number])[] => {
  const numbers = path.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  return numbers.flatMap((value, index) =>
    index % 2 === 0 ? [[value, numbers[index + 1] ?? Number.NaN] as const] : [],
  );
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

/**
 * Signed curvature samples along every cubic of a path: the cross product
 * of the first and second derivatives. A convex outline never changes sign.
 */
const curvatureSigns = (path: string): readonly number[] => {
  const [start, ...rest] = pointsOf(path);
  const segments: (readonly (readonly [number, number])[])[] = [];
  let from = start ?? [0, 0];
  for (let index = 0; index + 2 < rest.length; index += 3) {
    const [c1, c2, to] = rest.slice(index, index + 3) as [
      readonly [number, number],
      readonly [number, number],
      readonly [number, number],
    ];
    segments.push([from, c1, c2, to]);
    from = to;
  }
  return segments.flatMap(([p0, p1, p2, p3]) =>
    Array.from({ length: 49 }, (_, step) => {
      const t = (step + 1) / 50;
      const d = (a: number, b: number, c: number, e: number) =>
        3 * (1 - t) ** 2 * (b - a) +
        6 * (1 - t) * t * (c - b) +
        3 * t ** 2 * (e - c);
      const dd = (a: number, b: number, c: number, e: number) =>
        6 * (1 - t) * (c - 2 * b + a) + 6 * t * (e - 2 * c + b);
      const [x0, y0] = p0 ?? [0, 0];
      const [x1, y1] = p1 ?? [0, 0];
      const [x2, y2] = p2 ?? [0, 0];
      const [x3, y3] = p3 ?? [0, 0];
      return (
        d(x0, x1, x2, x3) * dd(y0, y1, y2, y3) -
        d(y0, y1, y2, y3) * dd(x0, x1, x2, x3)
      );
    }),
  );
};

describe('petalPath convexity', () => {
  test('never bends inward anywhere in the tuning range', () => {
    const grid = (min: number, max: number) =>
      [0, 0.25, 0.5, 0.75, 1].map((f) => min + (max - min) * f);
    const dented = grid(6, 11).flatMap((length) =>
      grid(3, 7).flatMap((width) =>
        grid(0.4, 0.85).flatMap((bulb) =>
          grid(0, 1).flatMap((tipSharpness) => {
            const signs = curvatureSigns(
              petalPath(
                { length, width, bulb, tipSharpness },
                { tip: [0, 0], angle: 0, scale: 10 },
              ),
            );
            const inward = signs.some((value) => value < -1e-6);
            const outward = signs.some((value) => value > 1e-6);
            return inward && outward
              ? [`${length}/${width}/${bulb}/${tipSharpness}`]
              : [];
          }),
        ),
      ),
    );
    assert({
      given:
        'every petal on a grid over the brand sheet ranges, sharpness 0 to 1',
      should: 'curve one way all round the outline',
      actual: dented,
      expected: [],
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
