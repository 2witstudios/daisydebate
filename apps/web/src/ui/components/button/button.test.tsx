import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { Button } from './button';
import { buttonClass, type ButtonVariant } from './button-class';

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

const variants = [
  'primary',
  'secondary',
  'ghost',
  'on-media',
  'compact',
  'icon',
  'row',
  'chip',
  'pill',
  'tab',
  'text',
  'quiet',
  'touch',
] as const satisfies readonly ButtonVariant[];

test('every variant renders its own look and is a plain button by default', () => {
  const rendered = variants.map((variant) =>
    renderToStaticMarkup(h(Button, { variant, children: variant })),
  );
  assert({
    given: 'each named variant without a type',
    should: 'render a type="button" with that variant’s classes, each distinct',
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
