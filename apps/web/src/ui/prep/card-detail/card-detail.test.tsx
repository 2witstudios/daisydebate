import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  cardDetailView,
  type CardDetailQuery,
} from '../../../features/prep/card-detail';
import { getCard } from '../../../features/prep/get-card';
import { CardDelete } from './card-delete';
import { CardDetail } from './card-detail';

setupRitewayBun();

const card = (id: string) => {
  const found = getCard(id);
  if (found === undefined) throw new Error(`no sample ${id}`);
  return found;
};
const render = (over: Partial<CardDetailQuery>, id = 'cost-estimates') =>
  renderToString(
    h(CardDetail, {
      view: cardDetailView(
        card(id),
        { view: 'read', version: 0, ...over },
        160,
      ),
    }),
  );

describe('CardDetail', () => {
  test('the read view', () => {
    const html = render({});
    assert({
      given: 'the current version in the read view',
      should:
        'show the tag line as the one h1, the passage, provenance, notes, uses and versions',
      actual: [
        html.match(/<h1 /g)?.length,
        html.includes('Citation and provenance'),
        html.includes('Your credibility notes'),
        html.includes('Where it has been used'),
        html.includes('href="/prep/cases/aff-rights"'),
        html.includes('Highlight changed'),
        /aria-current="page"[^>]*>Read view/.test(html),
      ],
      expected: [1, true, true, true, true, true, true],
    });
  });

  test('the actions are inert except delete, which is a link', () => {
    const html = render({});
    assert({
      given: 'the action row',
      should:
        'disable Add to brief, Copy cite, Share and Edit and link Delete card',
      actual: [
        html.match(/<button [^>]*disabled=""/g)?.length,
        html.includes('href="/prep/cards/cost-estimates/delete"'),
        html.includes('aria-label="More actions"'),
      ],
      expected: [4, true, true],
    });
  });

  test('the full source and citation views', () => {
    const full = render({ view: 'full' });
    const cite = render({ view: 'cite' });
    assert({
      given: 'the full-source and citation views',
      should:
        'show the legend only in full and provenance in cite but not the read card',
      actual: [
        full.includes('Kept, not read'),
        full.includes('Citation and provenance'),
        cite.includes('Citation and provenance'),
        cite.includes('Kept, not read'),
      ],
      expected: [true, false, true, false],
    });
  });

  test('a past version says so', () => {
    const html = render({ version: 2 });
    assert({
      given: 'version 2',
      should: 'warn it is not current and link back',
      actual: [
        html.includes('Version 2</p>') || html.includes('Version 2<'),
        html.includes('Back to the current version'),
      ],
      expected: [true, true],
    });
  });

  test('a card that is used nowhere', () => {
    const html = render({}, 'framework-institutions');
    assert({
      given: 'an unused card',
      should: 'say not used yet and omit the update note',
      actual: [
        html.includes('Not used yet.'),
        html.includes('Changing this card'),
      ],
      expected: [true, false],
    });
  });
});

describe('CardDelete', () => {
  test('a card in use, and one that is not', () => {
    const used = renderToString(
      h(CardDelete, { card: card('cost-estimates') }),
    );
    const free = renderToString(
      h(CardDelete, { card: card('framework-institutions') }),
    );
    assert({
      given: 'a card used in 3 places and one used nowhere',
      should:
        'raise the in-use alert for the first and a plain confirmation for the other',
      actual: [
        used.includes('This card is used in 3 places'),
        used.includes('role="alert"'),
        free.includes('This cannot be undone.'),
        free.includes('role="alert"'),
      ],
      expected: [true, true, true, false],
    });
  });
});
