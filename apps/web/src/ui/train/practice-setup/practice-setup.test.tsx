import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { defaultConfig } from '../../../features/train/practice';
import { listBots } from '../../../features/train/bots';
import { defaultHubQuery } from '../../../features/train/query';
import { PracticeSetup } from './practice-setup';

setupRitewayBun();

const render = (config = defaultConfig, plan = defaultHubQuery) =>
  renderToString(h(PracticeSetup, { config, plan }));

describe('PracticeSetup', () => {
  test('a GET form carrying every choice', () => {
    const html = render();
    assert({
      given: 'the default set-up',
      should: 'be one GET form with side, motion, opponent and pacing radios',
      actual: [
        html.match(/<h1/g)?.length,
        html.includes('method="get"'),
        html.includes('action="/train/practice"'),
        ['side', 'motion', 'opp', 'coach', 'hints'].every((name) =>
          html.includes(`name="${name}"`),
        ),
        html.includes('Update summary'),
      ],
      expected: [1, true, true, true, true],
    });
  });

  test('the summary follows the config and Start carries it', () => {
    const html = render({ ...defaultConfig, side: 'neg', opponent: 'solo' });
    assert({
      given: 'Neg and solo speeches',
      should: 'say so in the summary and start with them',
      actual: [
        html.includes('Neg (Negative)'),
        html.includes('Solo, one seat'),
        html.includes('Practice · Unrated'),
        html.includes('href="/train/practice/live?side=neg&amp;opp=solo"'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('the own-motion field appears only for that choice', () => {
    assert({
      given: 'a sample motion, then the own-motion choice',
      should: 'show the text field only for own',
      actual: [
        render().includes('name="own"'),
        render({ ...defaultConfig, motion: 3, own: 'Zoos close.' }).includes(
          'name="own"',
        ),
      ],
      expected: [false, true],
    });
  });

  test('the plan and rules ride in hidden fields and links', () => {
    const html = render(
      {
        ...defaultConfig,
        rules: { speechMinutes: 7, prepMinutes: 4, seats: 'both' },
      },
      { mins: 10, did: ['review'] },
    );
    assert({
      given: 'custom rules inside a ten minute plan',
      should: 'keep them in hidden fields, Start and the back link',
      actual: [
        html.includes('name="speech" value="7"'),
        html.includes('name="mins" value="10"'),
        html.includes('name="did" value="review"'),
        html.includes('href="/train/progress?mins=10&amp;did=review"'),
        html.includes('speech=7'),
        html.includes('Custom rules'),
      ],
      expected: [true, true, true, true, true, true],
    });
  });

  test('the custom rules link starts from the current rules', () => {
    const html = render();
    assert({
      given: 'the default set-up',
      should: 'link to custom rules from this practice',
      actual: html.includes('href="/train/rules?'),
      expected: true,
    });
  });

  test('a chosen bot is named and kept through the form', () => {
    const bot = listBots()[1] ?? null;
    const html = renderToString(
      h(PracticeSetup, { config: defaultConfig, plan: defaultHubQuery, bot }),
    ).replaceAll('<!-- -->', '');
    assert({
      given: 'a practice set up against a chosen bot',
      should: 'name it, offer another, and carry it in a hidden field',
      actual: [
        html.includes(`Your opponent: <strong>${bot?.name}</strong>`),
        html.includes('Choose another'),
        html.includes(`name="bot" value="${bot?.id}"`),
      ],
      expected: [true, true, true],
    });
  });
});
