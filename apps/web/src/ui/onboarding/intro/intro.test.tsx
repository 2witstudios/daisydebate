import { join } from 'node:path';
import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { destinationHref } from '../../../features/destinations/destinations';
import { routeExists } from '../../test-support/route-exists';
import { stageColourClasses } from '../../test-support/stage-palette';
import { StylesStep } from './styles-step';
import { DebateStep } from './debate-step';
import { DaisyStep, type IntroStepProps } from './intro';

setupRitewayBun();

const appDirectory = join(import.meta.dir, '../../../app');

const props: IntroStepProps = {
  nextHref: '/onboarding/next?next=%2Flobby',
  backHref: '/onboarding/back?next=%2Flobby',
  skip: null,
};

const render = (step: typeof DaisyStep) =>
  renderToString(h(step, props)).replaceAll('<!-- -->', '');

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

const hrefs = (html: string) =>
  [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1] as string);

describe('DaisyStep', () => {
  test('the beta introduction', () => {
    const html = render(DaisyStep);
    const page = text(html);
    assert({
      given: 'the approved A variant',
      should:
        'open with the competitive promise, the product loop and the one Freestyle ladder',
      actual: [
        page.includes('1 of 6'),
        page.includes(
          'Debate is a competitive sport. Now anyone can compete: no tournament, no travel, no weekend required.',
        ),
        page.includes(
          'Lobby Choose ranked or casual and get matched with someone near your rating.',
        ),
        page.includes(
          'Debate Go live, make your case, and let a judge decide.',
        ),
        page.includes(
          'Ladder Ranked Freestyle results move your rating on the ladder.',
        ),
        stageColourClasses(html),
      ],
      expected: [true, true, true, true, true, []],
    });
  });

  test('the resolution draw', () => {
    const html = render(DaisyStep);
    const page = text(html);
    assert({
      given: 'the figure under the loop',
      should:
        'draw five resolutions, two struck by each side and one left to debate',
      actual: [
        page.includes('Resolution draw'),
        page.includes('Neg strikes first'),
        html.split('<del').length - 1,
        page.split('Aff struck').length - 1,
        page.split('Neg struck').length - 1,
        page.includes('This house would ban homework Debating'),
      ],
      expected: [true, true, 4, 2, 2, true],
    });
    assert({
      given: 'one ranked ladder',
      should: 'name no other ladder or retired standard',
      actual: ['Three ladders', 'Policy', 'Value', 'Season 1'].map((label) =>
        page.includes(label),
      ),
      expected: [false, false, false, false],
    });
  });
});

describe('StylesStep', () => {
  test('Freestyle and Custom', () => {
    const page = text(render(StylesStep));
    assert({
      given: 'the second step',
      should:
        'present Freestyle as the ranked standard with its draw and prep, and Custom as any rules, unranked',
      actual: [
        '2 of 6',
        'Freestyle and Custom',
        'Freestyle Ranked Daisy’s standard, with its own ladder.',
        'five resolutions are drawn from Daisy’s bank, and the sides strike them in turn until one is left. Neg strikes first.',
        'Then 20 minutes of prep',
        'Custom Unranked Any rules, any kind of debate.',
        'NSDA Lincoln-Douglas, NCFCA Team Policy or Public Forum, or write your own.',
        'Practice or compete, just not ranked.',
      ].map((line) => page.includes(line)),
      expected: Array(8).fill(true),
    });
  });

  test('two choices, Freestyle first', () => {
    const page = text(render(StylesStep));
    assert({
      given: 'the second step',
      should:
        'list Freestyle before Custom, with one Ranked and one Unranked label and no retired ladders',
      actual: [
        page.indexOf('Freestyle Ranked') < page.indexOf('Custom Unranked'),
        page.split('Unranked').length - 1,
        page.includes('Three ladders'),
        page.includes('Policy and Value'),
        page.includes('Value'),
        page.includes('each have a ladder'),
      ],
      expected: [true, 1, false, false, false, false],
    });
  });
});

describe('DebateStep', () => {
  test('the turn bar follows the engine', () => {
    const html = render(DebateStep);
    const page = text(html);
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
    assert({
      given: 'the bar',
      should: 'carry a text alternative naming every turn',
      actual: html.includes(
        'aria-label="Turn order: Aff Case 5 min, Neg questions 2 min, Neg Case 6 min, Aff questions 2 min, Aff Reply 3 min, Neg Reply 5 min, Aff Close 3 min"',
      ),
      expected: true,
    });
    assert({
      given: 'two 2-minute cross-examinations',
      should:
        'total 26 minutes of speaking and say prep is 20 minutes before the round, as freestyle runs it',
      actual: [
        page.includes(
          '26 minutes of speaking, plus 20 minutes of prep before the round begins, once the motion is struck.',
        ),
        page.includes('the other side has 2 minutes to question'),
      ],
      expected: [true, true],
    });
  });

  test('every link goes somewhere', () => {
    const links = hrefs(render(DebateStep)).filter(
      (href) => !href.startsWith('/onboarding/'),
    );
    assert({
      given: 'Practise a debate, Watch a debate and How ratings work',
      should: 'point at existing routes, through their launch flags',
      actual: [links, links.filter((href) => !routeExists(appDirectory, href))],
      expected: [
        [
          destinationHref('train'),
          destinationHref('watch'),
          destinationHref('leaderboard'),
        ],
        [],
      ],
    });
  });

  test('back and next', () => {
    const links = hrefs(render(DebateStep));
    assert({
      given: 'a step between two others',
      should: 'link Back and Next to the hrefs it was given',
      actual: [
        links.includes(props.backHref as string),
        links.includes(props.nextHref),
      ],
      expected: [true, true],
    });
  });
});
