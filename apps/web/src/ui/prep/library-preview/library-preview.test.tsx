import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { defaultLibraryQuery } from '../../../features/prep/library/library-query';
import { listLibrary } from '../../../features/prep/library/list-library';
import { LibraryPreview } from './library-preview';

setupRitewayBun();

const now = '2026-09-30T12:00:00.000Z';
const render = (item: string) => {
  const preview = listLibrary({ ...defaultLibraryQuery, item }, now).preview;
  if (preview === undefined) throw new Error(`no preview for ${item}`);
  return renderToString(h(LibraryPreview, { preview }));
};

describe('LibraryPreview', () => {
  test('a card', () => {
    const html = render('cost-estimates');
    assert({
      given: 'a team card',
      should:
        'badge it, name the team, offer share, add to brief and open, and show its passage, tags and usage',
      actual: [
        html.includes('>Evidence card<'),
        html.includes('Shared with [Team name]'),
        html.includes('Add to brief'),
        html.includes('href="/prep/cards/cost-estimates"'),
        html.includes('<blockquote'),
        html.includes('aria-label="Tags"'),
        html.includes('Edited 2 days ago · Used in 3'),
      ],
      expected: [true, true, true, true, true, true, true],
    });
  });

  test('a brief', () => {
    const html = render('rights-framework');
    assert({
      given: 'a brief',
      should:
        'share through its review page and offer no add to brief or passage',
      actual: [
        html.includes('href="/prep/briefs/rights-framework/review?share=open"'),
        html.includes('Add to brief'),
        html.includes('<blockquote'),
      ],
      expected: [true, false, false],
    });
  });
});
