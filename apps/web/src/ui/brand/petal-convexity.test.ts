import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { petalPath } from './petal';

setupRitewayBun();

/** Every coordinate pair the path passes through or steers by. */
const pointsOf = (path: string): readonly (readonly [number, number])[] => {
  const numbers = path.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  return numbers.flatMap((value, index) =>
    index % 2 === 0 ? [[value, numbers[index + 1] ?? Number.NaN] as const] : [],
  );
};

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
