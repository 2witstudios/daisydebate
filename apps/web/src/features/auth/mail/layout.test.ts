import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAuthEmail } from './templates';

setupRitewayBun();

const rendered = renderAuthEmail({
  kind: 'sign-in',
  url: 'https://daisy.example.com/auth/confirm?token=abc',
}).html;

/** sRGB hex → relative luminance (WCAG 2.x). */
function relativeLuminance(hex: string): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two sRGB hex colors, 1 (none) to 21 (max). */
function contrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const [lighter, darker] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

type MailElement = {
  readonly tag: string;
  readonly classes: readonly string[];
  readonly style: Readonly<Record<string, string>>;
  readonly parent: MailElement | null;
  text: string;
};

const VOID_TAGS = new Set(['meta', 'br', 'img', 'hr', 'link', '!doctype']);

const parseStyle = (declarations: string): Record<string, string> =>
  Object.fromEntries(
    declarations
      .split(';')
      .map((declaration) => declaration.split(/:(.*)/s, 2))
      .filter((pair): pair is [string, string] => pair.length === 2)
      .map(([property, value]) => [
        property.trim(),
        value.replace('!important', '').trim(),
      ]),
  );

const attribute = (attributes: string, name: string) =>
  new RegExp(`${name}="([^"]*)"`).exec(attributes)?.[1];

const elementFrom = (
  tag: string,
  attributes: string,
  parent: MailElement | undefined,
  text: string,
): MailElement => ({
  tag,
  classes: attribute(attributes, 'class')?.split(/\s+/) ?? [],
  style: parseStyle(attribute(attributes, 'style') ?? ''),
  parent: parent ?? null,
  text,
});

/**
 * The rendered body's elements, each with its classes, inline style, parent
 * and own text, walked from the real markup a mail client receives: the
 * colors under test are the emailed ones, not a copy of the palette.
 */
function parseElements(html: string): MailElement[] {
  const body = html.slice(html.indexOf('<body'));
  const elements: MailElement[] = [];
  const stack: MailElement[] = [];
  const token = /<(\/?)([a-z0-9!]+)([^>]*)>([^<]*)/gi;
  for (const [, closing, rawTag, attributes, text] of body.matchAll(token)) {
    const tag = rawTag!.toLowerCase();
    if (closing) {
      stack.pop();
      const parent = stack.at(-1);
      if (parent) parent.text += text!;
      continue;
    }
    const element = elementFrom(tag, attributes!, stack.at(-1), text!);
    elements.push(element);
    if (!VOID_TAGS.has(tag)) stack.push(element);
  }
  return elements;
}

type DarkRule = {
  readonly selector: readonly string[];
  readonly style: Readonly<Record<string, string>>;
};

/** The `prefers-color-scheme: dark` block's rules, in source order. */
function parseDarkRules(html: string): DarkRule[] {
  const block =
    /@media \(prefers-color-scheme: dark\) \{([\s\S]*?)\n\s*\}\n/.exec(
      html,
    )?.[1] ?? '';
  return [...block.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(
    ([, selector, declarations]) => ({
      selector: selector!.trim().split(/\s+/),
      style: parseStyle(declarations!),
    }),
  );
}

const matchesPart = (element: MailElement, part: string) =>
  part.startsWith('.')
    ? element.classes.includes(part.slice(1))
    : element.tag === part;

/** A descendant-combinator selector (`.a p`) matched right to left. */
function matchesSelector(element: MailElement, selector: readonly string[]) {
  if (!matchesPart(element, selector.at(-1)!)) return false;
  let rest = selector.slice(0, -1);
  for (let node = element.parent; node && rest.length; node = node.parent)
    if (matchesPart(node, rest.at(-1)!)) rest = rest.slice(0, -1);
  return rest.length === 0;
}

type Theme = 'light' | 'dark';

/**
 * The element's own declared value for a property: in dark mode an
 * `!important` media rule that matches it wins, else its inline style.
 * An inherited dark color never beats an element's own inline color.
 */
function ownValue(
  element: MailElement,
  property: string,
  theme: Theme,
  rules: readonly DarkRule[],
): string | undefined {
  const dark =
    theme === 'dark'
      ? rules
          .filter(
            (rule) =>
              rule.style[property] && matchesSelector(element, rule.selector),
          )
          .at(-1)?.style[property]
      : undefined;
  return dark ?? element.style[property];
}

/** Color inherits; the backdrop is the nearest painted ancestor. */
function resolved(
  element: MailElement,
  property: 'color' | 'background',
  theme: Theme,
  rules: readonly DarkRule[],
): string | undefined {
  for (let node: MailElement | null = element; node; node = node.parent) {
    const value = ownValue(node, property, theme, rules);
    if (value) return value;
  }
  return undefined;
}

const elements = parseElements(rendered);
const darkRules = parseDarkRules(rendered);

/** Every element that paints visible text (the hidden preheader excluded). */
const visibleText = elements.filter(
  (element) =>
    element.text.replaceAll('&nbsp;', '').trim() !== '' &&
    element.style.display !== 'none',
);

/** Text runs whose color on their backdrop falls under WCAG AA (4.5:1). */
function contrastFailures(theme: Theme): string[] {
  return visibleText.flatMap((element) => {
    const color = resolved(element, 'color', theme, darkRules);
    const backdrop = resolved(element, 'background', theme, darkRules);
    if (!color || !backdrop)
      return [`<${element.tag}> "${element.text.trim()}" has no color`];
    const ratio = contrastRatio(color, backdrop);
    return ratio >= 4.5
      ? []
      : [
          `<${element.tag}> "${element.text.trim()}" ${color} on ${backdrop} is ${ratio.toFixed(2)}:1`,
        ];
  });
}

describe('AUTH-3.9 auth email layout: width, dark mode and contrast (ISSUE-167)', () => {
  test('keeps the message surface fluid up to a 600px cap', () => {
    const surface = elements.find(
      (element) =>
        element.tag === 'table' &&
        element.classes.includes('auth-mail-surface'),
    );
    assert({
      given: 'the rendered message surface',
      should: 'fill the viewport width and stop at 600px',
      actual: {
        width: surface?.style.width,
        maxWidth: surface?.style['max-width'],
      },
      expected: { width: '100%', maxWidth: '600px' },
    });
  });

  test('gives every themed class a dark-mode override', () => {
    const themed = [
      ...new Set(
        elements.flatMap((element) =>
          element.classes.filter((name) => name.startsWith('auth-mail-')),
        ),
      ),
    ];
    const overridden = new Set(
      darkRules.flatMap((rule) =>
        rule.selector
          .filter((part) => part.startsWith('.'))
          .map((part) => part.slice(1)),
      ),
    );
    assert({
      given: 'every auth-mail-* class the markup uses',
      should: 'each be restyled under prefers-color-scheme: dark',
      actual: themed.filter((name) => !overridden.has(name)),
      expected: [],
    });
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`every visible ${theme}-mode text run meets WCAG AA (4.5:1) on its backdrop`, () => {
      assert({
        given: `the rendered email's text as a ${theme}-mode client paints it`,
        should: 'each run reach at least a 4.5:1 contrast ratio',
        actual: contrastFailures(theme),
        expected: [],
      });
    });
  }
});
