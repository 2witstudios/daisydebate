import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import tailwind from '@tailwindcss/postcss';
import postcss from 'postcss';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

const stylesheet = join(import.meta.dir, 'globals.css');

/** Compiles the real globals.css with exactly the given candidate classes. */
const compile = async (classes: string): Promise<string> => {
  const source = `${readFileSync(stylesheet, 'utf8')}\n@source inline("${classes}");`;
  const result = await postcss([tailwind() as postcss.AcceptedPlugin]).process(
    source,
    {
      from: stylesheet,
    },
  );
  return result.css;
};

describe('Tailwind theme (ADR 0028)', () => {
  test('generates nothing for default-theme utilities', async () => {
    const css = await compile(
      'bg-red-500 p-7 text-4xl rounded-2xl shadow-md sm:p-4 font-sans',
    );
    assert({
      given: 'default Tailwind utilities that Daisy tokens do not define',
      should: 'emit no rule for any of them',
      actual: [
        'bg-red-500',
        'p-7',
        'text-4xl',
        'rounded-2xl',
        'shadow-md',
        'sm\\:p-4',
        'font-sans',
      ].filter((name) => css.includes(`.${name}`)),
      expected: [],
    });
  });

  test('resolves token utilities through the custom properties', async () => {
    const css = await compile('bg-surface p-4 text-ink-muted shadow-2');
    assert({
      given: 'utilities named after Daisy tokens',
      should:
        'emit var() references, so the theme switch needs no class change',
      actual: [
        css.includes('background-color: var(--surface)'),
        css.includes('padding: var(--spacing-4)'),
        css.includes('color: var(--text-muted)'),
        css.includes('--tw-shadow: var(--elevation-2)'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('keeps the desktop-first ranges as max-* variants', async () => {
    const css = await compile('max-rail:p-2 short:p-2');
    assert({
      given: 'a named breakpoint and the short-viewport variant',
      should:
        'emit a max-width range inclusive of 1100px and a max-height query',
      actual: [
        css.includes('(width < 1101px)'),
        css.includes('(max-height: 660px)'),
      ],
      expected: [true, true],
    });
  });
});
