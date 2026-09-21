import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

const css = readFileSync(join(import.meta.dir, 'globals.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** Every custom property declared in any `:root…` rule, name → value. */
const rootTokens = (): ReadonlyMap<string, string> =>
  new Map(
    [...css.matchAll(/(^|\n):root[^{]*\{([^}]*)\}/g)].flatMap((rule) =>
      [...(rule[2] ?? '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(
        (declaration) =>
          [declaration[1] ?? '', (declaration[2] ?? '').trim()] as const,
      ),
    ),
  );

const literalColor = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/i;

/** Colors outside light-dark() are pinned to one scheme. */
const pinnedColor = (value: string): boolean =>
  literalColor.test(value.replace(/light-dark\((?:[^()]|\([^()]*\))*\)/g, ''));

describe('globals.css theme tokens', () => {
  test('finds the color tokens it guards', () => {
    const tokens = rootTokens();
    assert({
      given: 'the root token rules',
      should: 'see the core surface, text, and accent tokens',
      actual: ['--background', '--text', '--accent', '--shadow-1'].filter(
        (name) => !tokens.has(name),
      ),
      expected: [],
    });
  });

  test('defines every color token for both schemes', () => {
    assert({
      given: 'every custom property on :root',
      should: 'write each literal color inside light-dark()',
      actual: [...rootTokens()]
        .filter(([, value]) => pinnedColor(value))
        .map(([name]) => name),
      expected: [],
    });
  });

  test('flags a color written for one scheme only', () => {
    assert({
      given: 'a bare hex, a bare rgba shadow, and a light-dark() pair',
      should: 'flag only the values pinned to one scheme',
      actual: [
        '#0a0e0c',
        '0 1px 2px rgba(0, 0, 0, 0.35)',
        '0 1px 2px light-dark(rgba(20, 32, 26, 0.08), rgba(0, 0, 0, 0.35))',
      ].map(pinnedColor),
      expected: [true, true, false],
    });
  });

  test('selects a color scheme for every preference', () => {
    assert({
      given: 'the data-theme rules',
      should: 'map dark, light, and system to their color-scheme',
      actual: ['dark', 'light', 'system'].map(
        (theme) =>
          new RegExp(
            `:root\\[data-theme='${theme}'\\]\\s*\\{\\s*color-scheme:\\s*([^;]+);`,
          ).exec(css)?.[1],
      ),
      expected: ['dark', 'light', 'light dark'],
    });
  });
});
