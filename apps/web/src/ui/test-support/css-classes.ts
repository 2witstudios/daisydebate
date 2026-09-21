/**
 * Test support: CSS modules resolve to `undefined` under `bun test`, so class
 * correctness is checked against the stylesheet text instead.
 *
 * A class counts as defined when some rule has a selector in which `.name`
 * stands alone as a compound: `.name`, `.name:hover`, `.a, .name`,
 * `.name .child`, `.parent > .name`. A compound-only use (`.other.name`,
 * `.name.other`) or a mention inside a comment does not count.
 */
const escapeForRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

const selectorsOf = (css: string): readonly string[] =>
  [
    ...css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/"[^"]*"|'[^']*'/g, '""')
      .matchAll(/([^{}]+)\{/g),
  ]
    .map((match) => (match[1] ?? '').trim())
    .filter((prelude) => !prelude.startsWith('@'))
    .flatMap((prelude) => prelude.split(','))
    .map((selector) => selector.trim());

export const definesClass = (css: string, name: string): boolean => {
  const standalone = new RegExp(
    `(^|[\\s>+~])\\.${escapeForRegExp(name)}(?=$|[\\s>+~:])`,
  );
  return selectorsOf(css).some((selector) => standalone.test(selector));
};
