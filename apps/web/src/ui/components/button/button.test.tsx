import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { Button, type ButtonProps } from './button';
import { buttonClass, buttonSizes, type ButtonVariant } from './button-class';

setupRitewayBun();

describe('Button', () => {
  test('renders children as a button by default', () => {
    const html = renderToString(h(Button, { children: 'Register' }));
    assert({
      given: 'a button without props',
      should: 'render the label inside a button element',
      actual: [
        html.includes('Register'),
        html.includes('<button'),
        html.includes('type="button"'),
      ],
      expected: [true, true, true],
    });
  });

  test('forwards native attributes', () => {
    const html = renderToString(
      h(Button, { type: 'submit', disabled: true, children: 'Register' }),
    );
    assert({
      given: 'a disabled submit button',
      should: 'forward the native attributes',
      actual: [html.includes('disabled'), html.includes('type="submit"')],
      expected: [true, true],
    });
  });
});

test('a submitter keeps its form, command value and the classes its site adds', () => {
  const html = renderToString(
    h(Button, {
      variant: 'text',
      type: 'submit',
      name: 'intent',
      value: 'save',
      form: 'settings',
      className: 'text-ink',
      children: 'Save',
    }),
  );
  assert({
    given: 'a text submitter associated with another form',
    should:
      'submit that form with its command, the variant look and the site ink',
    actual: [
      'type="submit"',
      'name="intent"',
      'value="save"',
      'form="settings"',
      `class="${buttonClass('text')} text-ink"`,
      'Save</button>',
    ].map((part) => html.includes(part)),
    expected: [true, true, true, true, true, true],
  });
});

const variants = Object.keys(buttonSizes) as ButtonVariant[];

test('every variant renders its own look and is a plain button by default', () => {
  const rendered = variants.map((variant) =>
    renderToStaticMarkup(
      h(Button, { variant, children: variant } as ButtonProps),
    ),
  );
  assert({
    given: 'each named variant without a type or size',
    should:
      'render a type="button" with that variant’s regular classes, each distinct',
    actual: [
      rendered.every((html, index) =>
        html.startsWith(
          `<button type="button" class="${buttonClass(variants[index]!)}">`,
        ),
      ),
      new Set(variants.map((variant) => buttonClass(variant))).size,
    ],
    expected: [true, variants.length],
  });
});

test('every size of every variant is its own class list, the look kept', () => {
  const pairs = variants.flatMap((variant) =>
    buttonSizes[variant].map((size) => ({ variant, size })),
  );
  const classes = pairs.map(({ variant, size }) =>
    buttonClass(variant, size as never),
  );
  assert({
    given: 'each variant at each size it comes in',
    should:
      'start from the variant’s look and give each size of a variant a different class list',
    actual: [
      pairs.every(({ variant }, index) =>
        classes[index]!.startsWith(
          buttonClass(variant).split(' ').slice(0, 3).join(' '),
        ),
      ),
      variants.every(
        (variant) =>
          new Set(
            buttonSizes[variant].map((size) =>
              buttonClass(variant, size as never),
            ),
          ).size === buttonSizes[variant].length,
      ),
      variants.every((variant) => buttonSizes[variant].includes('regular')),
    ],
    expected: [true, true, true],
  });
});

test('a sized action swaps its padding and type size, never doubling a property', () => {
  assert({
    given: 'a primary in a Room bar and a ghost at its small size',
    should: 'carry exactly one padding and one type size each',
    actual: [
      buttonClass('primary', 'room'),
      buttonClass('ghost', 'small')
        .split(' ')
        .filter((c) => /^(px|py|text-(sm|base))-?/.test(c)),
    ],
    expected: [
      `${buttonClass('primary').replace(' px-5 py-3 text-base', '')} min-h-room-target px-4 text-sm whitespace-nowrap`,
      ['px-3', 'py-2', 'text-sm'],
    ],
  });
});
