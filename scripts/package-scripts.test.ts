import { assert, describe, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

const root = new URL('..', import.meta.url).pathname;
const { scripts } = (await Bun.file(`${root}package.json`).json()) as {
  scripts: Record<string, string>;
};

const lintTimeout = (script: string | undefined): number =>
  Number(
    /bun test --timeout (\d+) eslint\.config\.test\.ts/.exec(
      script ?? '',
    )?.[1] ?? 0,
  );

describe('package scripts', () => {
  test('runs the ESLint configuration test with a load-tolerant timeout', () => {
    assert({
      given: 'the lint and test:lint scripts',
      should:
        'give eslint.config.test.ts at least two minutes, not the fixed 5 s default',
      actual: [
        lintTimeout(scripts.lint),
        lintTimeout(scripts['test:lint']),
      ].map((ms) => ms >= 120_000),
      expected: [true, true],
    });
  });
});
