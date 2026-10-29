import { join } from 'node:path';
import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { destinationHref } from '../../../features/coming-soon/launch';
import { routeExists } from '../../test-support/route-exists';
import { stageColourClasses } from '../../test-support/stage-palette';
import { DebateStep } from './debate-step';
import { DaisyStep, WhyStep, type IntroStepProps } from './intro';

setupRitewayBun();

const appDirectory = join(import.meta.dir, '../../../app');

const props: IntroStepProps = {
  nextHref: '/onboarding/next?next=%2Flobby',
  backHref: '/onboarding/back?next=%2Flobby',
  skip: null,
};

const render = (step: typeof WhyStep) =>
  renderToString(h(step, props)).replaceAll('<!-- -->', '');

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

/** The h1's own text, with its inline highlight span flattened into it. */
const headline = (html: string) =>
  (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

const hrefs = (html: string) =>
  [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1] as string);

describe('WhyStep', () => {
  test('the hero', () => {
    const page = text(render(WhyStep));
    assert({
      given: 'the first step',
      should: 'state the headline and the three pillars with their lines',
      actual: [
        headline(render(WhyStep)) ===
          `You don't have to wait for a tournament to compete.`,
        page.includes(
          'Any time A competitive round fits into an evening, not a weekend.',
        ),
        page.includes('Anyone No club or bracket needed. Sign up and debate.'),
        page.includes(
          "Real Real opponents, real stakes: a judge's written verdict decides every round.",
        ),
      ],
      expected: [true, true, true, true],
    });
  });

  test('the hero sits on the page palette', () => {
    const html = render(WhyStep);
    assert({
      given: 'the hero card',
      should: 'draw on a raised page surface with no stage colour',
      actual: {
        raised: html.includes('bg-surface-raised'),
        stage: stageColourClasses(html),
      },
      expected: { raised: true, stage: [] },
    });
  });
});

describe('DaisyStep', () => {
  test('the three steps', () => {
    const html = render(DaisyStep);
    const page = text(html);
    const order = ['Join a debate', 'Debate', 'Climb the ladders'].map(
      (title) => page.indexOf(title),
    );
    assert({
      given: 'how Daisy works',
      should: 'list the three steps in order',
      actual: order.every((at, index) => at > (order[index - 1] ?? -1)),
      expected: true,
    });
    assert({
      given: 'no orientation video and three ladders at launch',
      should:
        'offer no video and no strike lesson: striking belongs to each format',
      actual: [
        page.includes('Play the orientation'),
        html.includes('did='),
        page.includes('strike'),
        page.includes('three ladders — one per format'),
      ],
      expected: [false, false, false, true],
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
