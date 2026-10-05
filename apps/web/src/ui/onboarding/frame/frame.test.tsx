import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  NextButton,
  NextLink,
  OnboardingFrame,
  StepFooter,
  onboardingSteps,
} from './frame';

setupRitewayBun();

const frame = (step: number | null, skip?: string) =>
  renderToString(
    h(
      OnboardingFrame,
      {
        step,
        titleId: 'step-title',
        skip: skip ? h('form', null, h('button', null, skip)) : undefined,
      },
      h('h1', { id: 'step-title' }, 'About you'),
    ),
  );

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe('OnboardingFrame', () => {
  test('the card', () => {
    const html = frame(2, 'Skip');
    assert({
      given: 'the second step',
      should: 'be a dialog labelled by the step heading',
      actual: html.includes('role="dialog" aria-labelledby="step-title"'),
      expected: true,
    });
    assert({
      given: 'the second step',
      should: 'say 2 of 6 and fill two of six segments',
      actual: [
        html.includes(`2 of ${onboardingSteps}`),
        count(html, 'data-segment="done"'),
        count(html, 'data-segment="todo"'),
      ],
      expected: [true, 2, 4],
    });
    assert({
      given: 'a skip control',
      should: 'render it in the header',
      actual: html.includes('<button>Skip</button>'),
      expected: true,
    });
  });

  test('the last step', () => {
    const html = frame(null);
    assert({
      given: 'no step number',
      should: 'show no progress',
      actual: [html.includes('of 6'), html.includes('data-segment')],
      expected: [false, false],
    });
  });
});

describe('StepFooter', () => {
  test('back and next', () => {
    const html = renderToString(
      h(StepFooter, {
        backHref: '/onboarding/daisy?next=%2Flobby',
        next: h(NextLink, { href: '/onboarding/about' }, 'Next'),
      }),
    );
    assert({
      given: 'a step with a previous step',
      should: 'link Back to it and Next forward, both plain links',
      actual: [
        html.includes('href="/onboarding/daisy?next=%2Flobby"'),
        html.includes('href="/onboarding/about"'),
        count(html, 'min-h-onboarding-touch'),
      ],
      expected: [true, true, 2],
    });
  });

  test('the first step', () => {
    const html = renderToString(
      h(StepFooter, {
        backHref: null,
        next: h(NextButton, null, 'Finish'),
      }),
    );
    assert({
      given: 'no previous step and a submit',
      should: 'render no Back link and a submit button',
      actual: [html.includes('Back'), html.includes('type="submit"')],
      expected: [false, true],
    });
  });
});
