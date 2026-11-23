import { createElement as h } from 'react';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { Button, type ButtonProps } from '../ui/components/button/button';
import {
  buttonClass,
  buttonSizes,
  type ButtonVariant,
} from '../ui/components/button/button-class';

setupRitewayBun();

/**
 * A variant's look is a design-system visual contract with no accessible
 * equivalent: every variant is the same button to assistive technology, and
 * only its class list tells them apart.
 */
const variants = Object.keys(buttonSizes) as ButtonVariant[];

test('a submitter keeps the classes its site adds', () => {
  const html = renderMarkup(
    h(Button, {
      variant: 'text',
      type: 'submit',
      className: 'text-ink',
      children: 'Save',
    }),
  );
  assert({
    given: 'a text submitter with a site class',
    should: 'carry the variant look and the site ink',
    actual: html.includes(`class="${buttonClass('text')} text-ink"`),
    expected: true,
  });
});

test('every variant renders its own look and is a plain button by default', () => {
  const rendered = variants.map((variant) =>
    renderMarkup(h(Button, { variant, children: variant } as ButtonProps)),
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
