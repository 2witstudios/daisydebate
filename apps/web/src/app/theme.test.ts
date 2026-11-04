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

/** The enclosing media condition, shared by both compiled-rule views. */
const mediaOf = (rule: postcss.Rule): string | undefined => {
  let media: string | undefined;
  for (
    let node: postcss.Node | undefined = rule.parent;
    node;
    node = node.parent
  )
    if (node.type === 'atrule' && (node as postcss.AtRule).name === 'media')
      media = (node as postcss.AtRule).params;
  return media;
};

/**
 * The compiled rules, parsed: each selector's declarations and the media
 * query around it, so assertions read values, never substrings.
 */
const rulesOf = (css: string) => {
  const rules = new Map<
    string,
    { media: string | undefined; declarations: Record<string, string> }
  >();
  postcss.parse(css).walkRules((rule) => {
    const media = mediaOf(rule);
    const declarations: Record<string, string> = {};
    rule.walkDecls((declaration) => {
      declarations[declaration.prop] = declaration.value;
    });
    rules.set(rule.selector, { media, declarations });
  });
  return rules;
};

/** The same, but every rule with a selector is kept, in source order,
    with the rule's own declarations — nested at-rules are not flattened. */
const everyRuleOf = (css: string) => {
  const rules: {
    selector: string;
    media: string | undefined;
    declarations: Record<string, string>;
  }[] = [];
  postcss.parse(css).walkRules((rule) => {
    const media = mediaOf(rule);
    const declarations: Record<string, string> = {};
    for (const node of rule.nodes ?? [])
      if (node.type === 'decl') {
        const declaration = node as postcss.Declaration;
        declarations[declaration.prop] = declaration.value;
      }
    rules.push({ selector: rule.selector, media, declarations });
  });
  return rules;
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
        '.bg-red-500',
        '.p-7',
        '.text-4xl',
        '.rounded-2xl',
        '.shadow-md',
        '.sm\\:p-4',
        '.font-sans',
      ].filter((selector) => rulesOf(css).has(selector)),
      expected: [],
    });
  });

  test('resolves token utilities through the custom properties', async () => {
    const css = await compile('bg-surface p-4 text-ink-muted shadow-2');
    assert({
      given: 'utilities named after Daisy tokens',
      should:
        'emit var() references, so the theme switch needs no class change',
      actual: (() => {
        const rules = rulesOf(css);
        return {
          surface: rules.get('.bg-surface')?.declarations['background-color'],
          padding: rules.get('.p-4')?.declarations.padding,
          muted: rules.get('.text-ink-muted')?.declarations.color,
          shadow: rules.get('.shadow-2')?.declarations['--tw-shadow'],
        };
      })(),
      expected: {
        surface: 'var(--surface)',
        padding: 'var(--spacing-4)',
        muted: 'var(--text-muted)',
        shadow: 'var(--elevation-2)',
      },
    });
  });

  test('keeps the desktop-first ranges as max-* variants', async () => {
    const css = await compile('max-rail:p-2');
    assert({
      given: 'a named breakpoint',
      should: 'emit a max-width range inclusive of 1100px',
      actual: rulesOf(css).get('.max-rail\\:p-2'),
      expected: {
        media: '(width < 1101px)',
        declarations: { padding: 'var(--spacing-2)' },
      },
    });
  });

  test('wides the rail column only where the viewport holds words (ADR 0091)', async () => {
    const css = await compile('grid-shell grid-shell-extended');
    const rules = everyRuleOf(css);
    const unconditional = (selector: string) =>
      rules.find(
        (rule) => rule.selector === selector && rule.media === undefined,
      );
    assert({
      given: 'the shell grid and its extended modifier',
      should:
        'keep the mini track unconditional and apply the extended track from the token only at >=1101px',
      actual: [
        unconditional('.grid-shell')?.declarations['grid-template-columns'],
        unconditional('.grid-shell')?.declarations['--shell-left'],
        rules.find((rule) => rule.selector === '.grid-shell-extended')?.media,
        rules.find((rule) => rule.selector === '.grid-shell-extended')
          ?.declarations['--shell-left'],
      ],
      expected: [
        'var(--shell-left) minmax(0, 1fr) var(--shell-right)',
        'var(--spacing-nav-rail)',
        '(width >= 1101px)',
        'var(--spacing-nav-rail-extended)',
      ],
    });
  });

  test('a workspace page keeps the icon rail whatever was saved', async () => {
    const css = await compile('grid-shell-extended icon-rail:hidden');
    const rules = everyRuleOf(css);
    assert({
      given: 'the extended rail and a page marked as a workspace',
      should:
        'narrow the rail column, and apply the icon rail variant by width or by that page',
      actual: [
        rules.find(
          (rule) =>
            rule.selector === '.grid-shell-extended:has([data-workspace])',
        )?.declarations['--shell-left'],
        rules
          .filter((rule) => rule.selector.includes('icon-rail'))
          .some((rule) => rule.media === '(width < 1101px)'),
        rules
          .filter((rule) => rule.selector.includes('icon-rail'))
          .some((rule) => rule.selector.includes(':has([data-workspace])')),
      ],
      expected: ['var(--spacing-nav-rail)', true, true],
    });
  });

  test('a finger keeps the full target where a pointer gets the dense one', async () => {
    const css = await compile('h-dense-target');
    assert({
      given: 'the dense target',
      should:
        'be 28px, and take the 44px token for a coarse pointer or a phone',
      actual: [
        rulesOf(css).get(':root, :host')?.declarations[
          '--spacing-dense-target'
        ],
        everyRuleOf(css).find(
          (rule) =>
            rule.selector === ':root' &&
            rule.declarations['--spacing-dense-target'] !== undefined,
        )?.declarations['--spacing-dense-target'],
      ],
      expected: ['28px', 'var(--spacing-room-target)'],
    });
  });

  test('defines the extended rail width once, as a shell token', async () => {
    const css = await compile('grid-shell-extended');
    const tokens = rulesOf(css).get(':root, :host')?.declarations;
    assert({
      given: 'the compiled stylesheet',
      should: 'emit the 184px token on :root beside the 56px mini rail',
      actual: [
        tokens?.['--spacing-nav-rail-extended'],
        tokens?.['--spacing-nav-rail'],
      ],
      expected: ['184px', '56px'],
    });
  });
});
