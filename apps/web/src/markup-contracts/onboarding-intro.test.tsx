import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { stageColourClasses } from '../ui/test-support/stage-palette';
import { DebateStep } from '../ui/onboarding/intro/debate-step';
import { DaisyStep, type IntroStepProps } from '../ui/onboarding/intro/intro';

setupRitewayBun();

const props: IntroStepProps = {
  nextHref: '/onboarding/next?next=%2Flobby',
  backHref: '/onboarding/back?next=%2Flobby',
  skip: null,
};

/**
 * The opening slide's palette and the turn bar's segment widths are visual
 * contracts: the stage colours read cream on cream on a page surface, and
 * the bar's segments (aria-hidden; the list's name carries every turn) are
 * as wide as their turns are long.
 */
describe('DaisyStep markup', () => {
  test('three ways to use Daisy', () => {
    assert({
      given: 'the opening slide',
      should: 'take no stage colour',
      actual: stageColourClasses(
        renderMarkup(h(DaisyStep, { ...props, tabReleased: true })),
      ),
      expected: [],
    });
  });
});

describe('DebateStep markup', () => {
  test('the turn bar follows the engine', () => {
    const html = renderMarkup(h(DebateStep, props));
    assert({
      given: 'the one-on-one turn table, its 1AR at 3:00 (DEC-234)',
      should: 'draw seven segments as wide as they are long',
      actual: [
        ...html.matchAll(/basis-0 items-center[^"]*?(grow(?:-\d)?)/g),
      ].map((match) => match[1]),
      expected: [
        'grow-5',
        'grow-2',
        'grow-6',
        'grow-2',
        'grow-3',
        'grow-5',
        'grow-3',
      ],
    });
  });
});
