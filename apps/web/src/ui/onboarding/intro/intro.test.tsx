import { join } from 'node:path';
import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { routeExists } from '../../test-support/route-exists';
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

const hrefs = (html: string) =>
  [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1] as string);

describe('WhyStep', () => {
  test('the hero', () => {
    const page = text(render(WhyStep));
    assert({
      given: 'the first step',
      should: 'state the headline and the three pillars with their lines',
      actual: [
        page.includes('Debate is self-defense for free speech.'),
        page.includes('Learn Research the motion before you argue it.'),
        page.includes(
          'Reason Build a case, then defend it under cross-examination.',
        ),
        page.includes('Communicate Argue it out live with a real person.'),
      ],
      expected: [true, true, true, true],
    });
  });
});

describe('DaisyStep', () => {
  test('the five steps and the draw', () => {
    const html = render(DaisyStep);
    const page = text(html);
    const order = [
      'Watch the orientation',
      'Join a debate',
      'Prep the resolution',
      'Debate Live',
      'Climb the ladder',
    ].map((title) => page.indexOf(title));
    assert({
      given: 'how Daisy works',
      should: 'list the five steps in order',
      actual: order.every((at, index) => at > (order[index - 1] ?? -1)),
      expected: true,
    });
    assert({
      given: 'no orientation video yet',
      should: 'offer it as a sample action, never a placeholder',
      actual: [
        page.includes('Play the orientation'),
        html.includes('did=Play'),
        page.includes('['),
      ],
      expected: [true, true, false],
    });
    assert({
      given: 'the resolution draw',
      should: 'strike four motions and leave one to debate',
      actual: [
        (html.match(/<del /g) ?? []).length,
        page.includes('This house would ban homework Debating'),
      ],
      expected: [4, true],
    });
  });
});

describe('DebateStep', () => {
  test('the turn bar follows the engine', () => {
    const html = render(DebateStep);
    const page = text(html);
    assert({
      given: 'the one-on-one turn table',
      should: 'draw seven segments as wide as they are long',
      actual: [
        ...html.matchAll(/basis-0 items-center[^"]*?(grow(?:-\d)?)/g),
      ].map((match) => match[1]),
      expected: [
        'grow-5',
        'grow-2',
        'grow-6',
        'grow-2',
        'grow-5',
        'grow-5',
        'grow-3',
      ],
    });
    assert({
      given: 'the bar',
      should: 'carry a text alternative naming every turn',
      actual: html.includes(
        'aria-label="Turn order: Aff Case 5 min, Neg questions 2 min, Neg Case 6 min, Aff questions 2 min, Aff Reply 5 min, Neg Reply 5 min, Aff Close 3 min"',
      ),
      expected: true,
    });
    assert({
      given: 'two 2-minute cross-examinations',
      should: 'total 28 minutes of speaking and say Q&A is 2 minutes',
      actual: [
        page.includes('28 minutes of speaking, plus 4 minutes of prep'),
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
      should: 'point at existing routes',
      actual: [links, links.filter((href) => !routeExists(appDirectory, href))],
      expected: [['/train/rules', '/watch', '/leaderboard'], []],
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
