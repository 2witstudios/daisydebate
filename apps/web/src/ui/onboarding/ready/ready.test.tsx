import { join } from 'node:path';
import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  emptyAnswers,
  type OnboardingAnswers,
} from '../../../features/onboarding/answers';
import { destinationHref } from '../../../features/coming-soon/launch';
import { routeExists } from '../../test-support/route-exists';
import { clubAction, ReadyStep } from './ready';

setupRitewayBun();

const appDirectory = join(import.meta.dir, '../../../app');

const render = (answers: Partial<OnboardingAnswers> = {}) =>
  renderToString(
    h(ReadyStep, {
      answers: { ...emptyAnswers, ...answers },
      botNames: ['Juno', 'Wren', 'Bram'],
      homeHref: '/lobby',
      editHrefs: {
        about: '/onboarding/about?next=%2Flobby',
        experience: '/onboarding/experience?next=%2Flobby',
        topics: '/onboarding/topics?next=%2Flobby',
      },
    }),
  ).replaceAll('<!-- -->', '');

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

describe('ReadyStep', () => {
  test('two ways into a first debate', () => {
    const html = render();
    const page = text(html);
    assert({
      given: 'the last step',
      should:
        'offer a bot (naming the bots, through the Train launch flag) and a real person, side by side',
      actual: [
        page.includes('Your first debate'),
        page.includes('Debate a bot Juno, Wren or Bram'),
        page.includes('Debate a real person Ranked or casual'),
        html.includes(`href="${destinationHref('train')}"`),
        html.includes('href="/play"'),
        [destinationHref('train'), '/play'].every((href) =>
          routeExists(appDirectory, href),
        ),
      ],
      expected: [true, true, true, true, true, true],
    });
  });

  test('the answers to edit', () => {
    const page = text(
      render({
        wants: ['debate', 'watch'],
        club: 'own',
        experience: 'class',
        formats: ['one-on-one'],
        topics: ['ethics', 'law'],
      }),
    );
    assert({
      given: 'a member who answered every step',
      should: 'list each answer with an Edit link',
      actual: [
        page.includes('Wants to Debate, Watch Edit'),
        page.includes('Club On my own Edit'),
        page.includes('Experience Debated in class or a club Edit'),
        page.includes('Formats One-on-one Edit'),
        page.includes('Topics Ethics, Law Edit'),
      ],
      expected: [true, true, true, true, true],
    });
    assert({
      given: 'a member who skipped everything',
      should: 'show a dash for each answer',
      actual: (text(render()).match(/ — Edit/g) ?? []).length,
      expected: 5,
    });
  });

  test('no answer summary for a member not asked the questions', () => {
    const html = renderToString(
      h(ReadyStep, {
        answers: emptyAnswers,
        botNames: ['Juno'],
        homeHref: '/lobby',
        editHrefs: null,
      }),
    );
    assert({
      given: 'a member whose canonical age does not admit optional answers',
      should:
        'still offer a first debate, with no answer summary and no Edit link',
      actual: [
        html.includes('Debate a bot'),
        html.includes('<dl'),
        html.includes('/onboarding/about'),
      ],
      expected: [true, false, false],
    });
  });

  test('edit and home links keep next', () => {
    const html = render();
    assert({
      given: 'the summary and the home link',
      should: 'point Edit at the owning step and Go to home at next',
      actual: [
        html.includes('href="/onboarding/about?next=%2Flobby"'),
        html.includes('href="/onboarding/experience?next=%2Flobby"'),
        html.includes('href="/onboarding/topics?next=%2Flobby"'),
        html.includes('href="/lobby"'),
      ],
      expected: [true, true, true, true],
    });
  });
});

describe('clubAction', () => {
  test('the club row', () => {
    assert({
      given: 'starting a club, coaching, joining with a code, or on my own',
      should: 'offer create, create, join, and nothing',
      actual: [
        clubAction({ ...emptyAnswers, club: 'starting' }),
        clubAction({ ...emptyAnswers, wants: ['coach'], club: 'own' }),
        clubAction({ ...emptyAnswers, club: 'joining' }),
        clubAction({ ...emptyAnswers, club: 'own' }),
      ],
      expected: [
        'Create your club',
        'Create your club',
        'Join your club',
        null,
      ],
    });
  });
});
