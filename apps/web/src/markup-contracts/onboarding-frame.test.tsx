import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import {
  NextLink,
  OnboardingFrame,
  StepFooter,
} from '../ui/onboarding/frame/frame';

setupRitewayBun();

const frame = (step: number | null) =>
  renderMarkup(
    h(OnboardingFrame, {
      step,
      titleId: 'step-title',
      children: h('h1', { id: 'step-title' }, 'About you'),
    }),
  );

const count = (html: string, needle: string) => html.split(needle).length - 1;

/**
 * The progress segments are decoration (aria-hidden; the "2 of 8" text is
 * what a reader hears), and Back and Next share the touch-target class: both
 * are visual contracts with no accessible equivalent.
 */
describe('OnboardingFrame markup', () => {
  test('the progress segments', () => {
    assert({
      given: 'the second step, then no step number',
      should: 'fill two of eight segments, then draw none',
      actual: [
        count(frame(2), 'data-segment="done"'),
        count(frame(2), 'data-segment="todo"'),
        frame(null).includes('data-segment'),
      ],
      expected: [2, 6, false],
    });
  });
});

describe('StepFooter markup', () => {
  test('back and next', () => {
    const html = renderMarkup(
      h(StepFooter, {
        backHref: '/onboarding/daisy?next=%2Flobby',
        next: h(NextLink, { href: '/onboarding/about', children: 'Next' }),
      }),
    );
    assert({
      given: 'a step with a previous step',
      should: 'give Back and Next the onboarding touch target',
      actual: count(html, 'min-h-onboarding-touch'),
      expected: 2,
    });
  });
});
