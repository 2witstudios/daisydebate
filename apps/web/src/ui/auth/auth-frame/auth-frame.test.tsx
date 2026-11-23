import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { AuthFrame, AuthHeading } from './auth-frame';

setupRitewayBun();

describe('AuthFrame', () => {
  test('keeps the panel free of controls', () => {
    const view = renderAccessible(
      h(AuthFrame, {
        panel: { eyebrow: 'Why?', title: 'Because.', body: 'Details.' },
        footer: 'Footer line',
        children: h('button', { type: 'button' }, 'Act'),
      }),
    );
    const panel = view.within('complementary');
    assert({
      given: 'a step with a button',
      should:
        'link the logo home, render the panel copy, and keep controls out of the panel',
      actual: [
        view.attribute('link', 'Daisy Debate', 'href'),
        panel.textContent().includes('Why?'),
        panel.textContent().includes('Because.'),
        panel.textContent().includes('Details.'),
        panel.count('button'),
        view.textContent().includes('Footer line'),
      ],
      expected: ['/', true, true, true, 0, true],
    });
  });
});

describe('AuthHeading', () => {
  test('renders the eyebrow, the page heading, and the lede', () => {
    const view = renderAccessible(
      h(AuthHeading, { eyebrow: 'Step', title: 'Title.', children: 'Lede.' }),
    );
    assert({
      given: 'heading copy',
      should: 'use one h1 for the title',
      actual: [
        view.textContent().includes('Step'),
        view.count('heading', undefined, { level: 1 }),
        view.has('heading', 'Title.', { level: 1 }),
        view.textContent().includes('Lede.'),
      ],
      expected: [true, 1, true, true],
    });
  });
});
