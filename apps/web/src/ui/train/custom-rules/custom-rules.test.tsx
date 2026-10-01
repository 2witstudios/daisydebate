import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  customRulesView,
  parseCustomRulesQuery,
  ruleSetLinks,
} from '../../../features/train/custom-rules';
import type { SearchParams } from '../../../features/access/decision';
import { sampleSummary } from '../../mock/train';
import { CustomRules } from './custom-rules';

setupRitewayBun();

const render = (params: SearchParams = {}) => {
  const query = parseCustomRulesQuery(params);
  return renderToString(
    h(CustomRules, {
      view: customRulesView(query),
      query,
      ruleSets: ruleSetLinks(sampleSummary.ruleSets, query.plan),
    }),
  );
};

describe('CustomRules', () => {
  test('the sample rules and what they change', () => {
    const html = render();
    assert({
      given: 'the page opened with no choices',
      should: 'say practice only and show the rules, preview and difference',
      actual: [
        html.match(/<h1/g)?.length,
        html.includes('Practice only. Never rated.'),
        html.includes('7 min'),
        html.includes('4 min'),
        html.includes('Custom rules'),
        html.includes('Speech length is 7 min. The standard rules use 5.'),
        html.includes('Longer speeches'),
        html.includes('Save to my rule sets'),
        html.includes('Practice with these rules'),
      ],
      expected: [1, true, true, true, true, true, true, true, true],
    });
  });

  test('steppers are links named for their action', () => {
    const html = render();
    assert({
      given: 'speech 7',
      should: 'link Shorter and Longer speech length one minute either way',
      actual: [
        html.includes('aria-label="Shorter speech length"'),
        html.includes('aria-label="Longer prep time"'),
        html.includes('speech=6'),
        html.includes('speech=8'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('a stepper at its end is inert, not a link', () => {
    const html = render({ speech: '1' });
    assert({
      given: 'a one minute speech',
      should: 'disable Shorter speech length',
      actual:
        /aria-disabled="true"[^>]*aria-label="Shorter speech length"|aria-label="Shorter speech length"[^>]*aria-disabled="true"/.test(
          html,
        ),
      expected: true,
    });
  });

  test('standard values', () => {
    const html = render({ speech: '5', prep: '4' });
    assert({
      given: 'the standard rules',
      should: 'say so and list no differences',
      actual: [
        html.includes('Standard rules'),
        html.includes('Same as the standard rules.'),
      ],
      expected: [true, true],
    });
  });

  test('ranked refuses custom rules and says why', () => {
    const html = render({ ranked: '1' });
    assert({
      given: 'ranked asked for with custom speech length',
      should: 'show the alert with its reason and both ways out',
      actual: [
        html.includes('role="alert"'),
        html.includes('Ranked cannot use this table'),
        html.includes(
          'Ranked runs only the standard rules. These rules are custom.',
        ),
        html.includes('href="/lobby?mode=ranked"'),
        html.includes('Keep it as practice'),
      ],
      expected: [true, true, true, true, true],
    });
    assert({
      given: 'ranked not asked for',
      should: 'show no alert',
      actual: render().includes('role="alert"'),
      expected: false,
    });
  });

  test('saved', () => {
    const html = render({ saved: '1' });
    assert({
      given: 'the set saved',
      should: 'confirm and drop the save link',
      actual: [
        html.includes('Saved. Only you can see it.'),
        html.includes('Save to my rule sets'),
      ],
      expected: [true, false],
    });
  });

  test('the name is a GET form that keeps the rules', () => {
    const html = render({ speech: '6', name: 'Mine' });
    assert({
      given: 'a named rule set',
      should: 'carry the rules as hidden fields and name the field',
      actual: [
        html.includes('method="get"'),
        html.includes('action="/train/rules"'),
        /name="speech"[^>]*value="6"|value="6"[^>]*name="speech"/.test(html),
        html.includes('name="name"'),
        html.includes('value="Mine"'),
      ],
      expected: [true, true, true, true, true],
    });
  });

  test('your rule sets are unrated and start practices', () => {
    const html = render();
    assert({
      given: 'the two sample rule sets',
      should: 'list both as Unrated with a Practice link each',
      actual: [
        html.includes('Solo, one side'),
        html.match(/Unrated/g)?.length,
        html.includes('aria-label="Practice: Solo, one side"'),
        html.includes('href="/train/practice?opp=solo&amp;seats=solo"'),
        html.includes('Running a tournament?'),
      ],
      expected: [true, 2, true, true, true],
    });
  });
});
