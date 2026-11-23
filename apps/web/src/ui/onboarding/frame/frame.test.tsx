import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { NextButton, NextLink, OnboardingFrame, StepFooter } from './frame';

setupRitewayBun();

const frame = (step: number | null, skip?: string) =>
  renderAccessible(
    h(OnboardingFrame, {
      step,
      titleId: 'step-title',
      ...(skip ? { skip: h('form', null, h('button', null, skip)) } : {}),
      children: h('h1', { id: 'step-title' }, 'About you'),
    }),
  );

describe('OnboardingFrame', () => {
  test('the card', () => {
    const view = frame(2, 'Skip');
    assert({
      given: 'the second step',
      should: 'be a dialog labelled by the step heading',
      actual: view.has('dialog', 'About you'),
      expected: true,
    });
    assert({
      given: 'the second step',
      should: 'say 2 of 8',
      actual: view.textContent().includes('2 of 8'),
      expected: true,
    });
    assert({
      given: 'a skip control',
      should: 'render it in the header',
      actual: view.within('dialog', 'About you').has('button', 'Skip'),
      expected: true,
    });
  });

  test('the last step', () => {
    const view = frame(null);
    assert({
      given: 'no step number',
      should: 'show no progress',
      actual: view.textContent().includes('of 8'),
      expected: false,
    });
  });
});

describe('StepFooter', () => {
  test('back and next', () => {
    const view = renderAccessible(
      h(StepFooter, {
        backHref: '/onboarding/daisy?next=%2Flobby',
        next: h(NextLink, { href: '/onboarding/about', children: 'Next' }),
      }),
    );
    assert({
      given: 'a step with a previous step',
      should: 'link Back to it and Next forward, both plain links',
      actual: [
        view.attribute('link', 'Back', 'href'),
        view.attribute('link', 'Next', 'href'),
        view.names('link'),
        view.count('button'),
      ],
      expected: [
        '/onboarding/daisy?next=%2Flobby',
        '/onboarding/about',
        ['Back', 'Next'],
        0,
      ],
    });
  });

  test('the first step', () => {
    const view = renderAccessible(
      h(StepFooter, {
        backHref: null,
        next: h(NextButton, { children: 'Finish' }),
      }),
    );
    assert({
      given: 'no previous step and a submit',
      should: 'render no Back link and a submit button',
      actual: [
        view.textContent().includes('Back'),
        view.attribute('button', 'Finish', 'type'),
      ],
      expected: [false, 'submit'],
    });
  });
});
