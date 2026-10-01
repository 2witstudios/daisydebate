import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  cardCreateView,
  type CardCreateQuery,
} from '../../../features/prep/card-create';
import { CardCreate } from './card-create';

setupRitewayBun();

const base: CardCreateQuery = {
  step: 'source',
  src: 'paste',
  tool: 'read',
  url: '',
};
const render = (over: Partial<CardCreateQuery>) =>
  renderToString(
    h(CardCreate, { view: cardCreateView({ ...base, ...over }, 160) }),
  );

describe('CardCreate', () => {
  test('step 1, paste', () => {
    const html = render({});
    assert({
      given: 'the first step in paste mode',
      should:
        'show one h1, step tabs with the first current, a textarea and a Next link, plus the preview rail',
      actual: [
        html.match(/<h1 /g)?.length,
        /aria-current="page"[^>]*>1\s+Source/.test(html),
        html.includes('<textarea'),
        html.includes('href="/prep/cards/new?step=highlight"'),
        html.includes('words detected'),
        html.includes('aria-label="Preview"'),
        html.includes('5 of 7 fields'),
      ],
      expected: [1, true, true, true, true, true, true],
    });
  });

  test('step 1, link is a GET form with the address kept', () => {
    const html = render({ src: 'link', url: 'https://x.org/article' });
    assert({
      given: 'the link mode with a fetched address',
      should:
        'post a GET form to /prep/cards/new, show the fetched page and offer Next',
      actual: [
        /<form [^>]*method="get"/.test(html),
        html.includes('value="https://x.org/article"'),
        html.includes('Page fetched.'),
        html.includes('Author A]'),
        html.includes('Next: highlight'),
      ],
      expected: [true, true, true, true, true],
    });
  });

  test('step 1, link problems', () => {
    assert({
      given: 'an unreachable link and a bad one',
      should: 'alert with the matching copy and offer no Next',
      actual: [
        render({ src: 'link', url: 'https://x.org/unreachable' }).includes(
          'We could not open that page',
        ),
        render({ src: 'link', url: 'nope' }).includes(
          'Enter a link that starts with',
        ),
        render({ src: 'link', url: 'https://x.org/unreachable' }).includes(
          'Next: highlight',
        ),
      ],
      expected: [true, true, false],
    });
  });

  test('step 1, file', () => {
    const html = render({ src: 'file' });
    assert({
      given: 'the file mode',
      should: 'offer the dropzone and say nothing is uploaded yet',
      actual: [
        html.includes('type="file"'),
        html.includes('Nothing is uploaded yet'),
      ],
      expected: [true, true],
    });
  });

  test('step 2', () => {
    const html = render({ step: 'highlight', tool: 'keep' });
    assert({
      given: 'the highlight step with the keep tool',
      should:
        'mark the tool, show words read and read time, and the layered text',
      actual: [
        /aria-current="true"[^>]*>.*Keep, do not read/.test(html),
        html.includes('at your pace of [160] words a minute'),
        html.includes('<mark'),
        html.includes('href="/prep/cards/new?tool=keep"'),
        html.includes('Next: cite and save'),
      ],
      expected: [true, true, true, true, true],
    });
  });

  test('step 3', () => {
    const html = render({ step: 'cite' });
    assert({
      given: 'the cite step',
      should:
        'show every citation field, warn about the missing date and leave saving inert',
      actual: [
        html.match(/<label /g)?.length,
        html.includes('The publication date is missing'),
        html.includes('Missing: publication date, credibility note'),
        /<button [^>]*disabled=""[^>]*>.*Save card/.test(html),
        html.includes('Save and add to brief'),
      ],
      expected: [10, true, true, true, true],
    });
  });
});
