import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { emptySummary } from '../../../features/train/summary';
import { sampleSummary } from '../../mock/train';
import { RuleSetsCard } from './rule-sets-card';
import { SavedCard } from './saved-card';

setupRitewayBun();

describe('SavedCard', () => {
  test('a library', () => {
    const html = renderToString(h(SavedCard, { summary: sampleSummary }));
    assert({
      given: '42 saved, 6 due',
      should: 'count them and link to the library',
      actual: [
        html.includes('42'),
        html.includes('saved, 6 due today'),
        html.includes('href="/train/review"'),
      ],
      expected: [true, true, true],
    });
  });

  test('nothing saved', () => {
    const html = renderToString(h(SavedCard, { summary: emptySummary }));
    assert({
      given: 'no saved arguments',
      should: 'explain where they come from and offer no library',
      actual: [html.includes('None yet.'), html.includes('Open library')],
      expected: [true, false],
    });
  });
});

describe('RuleSetsCard', () => {
  test('rule sets are always unrated', () => {
    const html = renderToString(h(RuleSetsCard, { summary: sampleSummary }));
    assert({
      given: 'two rule sets',
      should: 'list both as Unrated and link to custom rules',
      actual: [
        html.includes('Longer speeches'),
        html.includes('Solo, one side'),
        html.match(/Unrated/g)?.length,
        html.includes('href="/train/rules"'),
      ],
      expected: [true, true, 2, true],
    });
  });
});
