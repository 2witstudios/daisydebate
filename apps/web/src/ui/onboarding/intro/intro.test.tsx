import { join } from 'node:path';
import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { destinationHref } from '../../../features/coming-soon/launch';
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
        'open with the competitive promise, the product loop and three ladders',
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
          'Ladder Ranked results move your rating on that format’s ladder.',
        ),
        ...['Three ladders', 'Season 1', 'Freestyle', 'Policy', 'Value'].map(
          (label) => page.includes(label),
        ),
        stageColourClasses(html),
      ],
      expected: [
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        [],
      ],
    });
  });
});

describe('StylesStep', () => {
  test('three ranked ladders and the custom format', () => {
    const page = text(render(StylesStep));
    assert({
      given: 'the second step',
      should:
        'present Freestyle, Policy and Value as ranked ladders and custom debates as unranked',
      actual: [
        '2 of 6',
        'Ranked ladders and custom formats',
        'each have a ladder',
        'Five resolutions are drawn at the table.',
        'Schools should ban smartphones during the school day.',
        'Privacy ought to be valued above public safety.',
        'Want your own rules? Host a custom debate',
        'Practice or compete, just not ranked.',
      ].map((line) => page.includes(line)),
      expected: Array(8).fill(true),
    });
  });

  test('ladder order and ranked labels', () => {
    const page = text(render(StylesStep));
    assert({
      given: 'the second step',
      should:
        'list Freestyle before Policy and Value, mark exactly three ranked ladders and one unranked card',
      actual: [
        page.indexOf('Freestyle') < page.indexOf('Policy'),
        page.indexOf('Policy') < page.indexOf('Value'),
        page.match(/Ranked ladder(?!s)/g)?.length,
        page.split('Unranked').length - 1,
        page.includes('Three ways to debate'),
        page.includes('A Freestyle draw'),
      ],
      expected: [true, true, 3, 1, false, false],
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
      should: 'total 26 minutes of speaking and say Q&A is 2 minutes',
      actual: [
        page.includes('26 minutes of speaking, plus 4 minutes of prep'),
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
      given: 'Read the rules, Watch a debate and How ratings work',
      should: 'point at existing routes, through their launch flags',
      actual: [links, links.filter((href) => !routeExists(appDirectory, href))],
      expected: [
        [
          destinationHref('train', { path: '/train/rules' }),
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
