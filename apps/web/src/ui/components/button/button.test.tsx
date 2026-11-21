import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { Button } from './button';

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

test('an unstyled submitter keeps native defaults and attributes', () => {
  const html = renderToString(
    h(Button, {
      variant: 'unstyled',
      name: 'intent',
      value: 'save',
      form: 'settings',
      className: 'text-ink',
      children: 'Save',
    }),
  );
  assert({
    given: 'a form-associated button without an explicit type',
    should: 'retain the native submit default, command value and exact classes',
    actual: [
      '<button',
      'name="intent"',
      'value="save"',
      'form="settings"',
      'class="text-ink"',
      'Save</button>',
      'type=',
    ].map((part) => html.includes(part)),
    expected: [true, true, true, true, true, true, false],
  });
});
