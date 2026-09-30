import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  cardCreateHref,
  cardCreateView,
  parseCardCreateQuery,
  type CardCreateQuery,
} from './card-create';

setupRitewayBun();

const base: CardCreateQuery = {
  step: 'source',
  src: 'paste',
  tool: 'read',
  url: '',
};
const view = (over: Partial<CardCreateQuery>) =>
  cardCreateView({ ...base, ...over }, 160);

describe('parseCardCreateQuery', () => {
  test('defaults, values and bad values', () => {
    assert({
      given: 'nothing, valid values, and junk',
      should: 'give defaults, the values, then defaults again',
      actual: [
        parseCardCreateQuery({}),
        parseCardCreateQuery({
          step: 'cite',
          src: 'link',
          tool: 'keep',
          url: ' https://a.b/c ',
        }),
        parseCardCreateQuery({ step: 'nine', src: 'fax', tool: '\u0000' }),
      ],
      expected: [
        base,
        { step: 'cite', src: 'link', tool: 'keep', url: 'https://a.b/c' },
        base,
      ],
    });
  });

  test('hrefs keep only non-defaults', () => {
    assert({
      given: 'the default, and a step with a link',
      should: 'omit defaults from the URL',
      actual: [
        cardCreateHref(base),
        cardCreateHref({
          ...base,
          step: 'highlight',
          src: 'link',
          url: 'https://a.b',
        }),
      ],
      expected: [
        '/prep/cards/new',
        '/prep/cards/new?step=highlight&src=link&url=https%3A%2F%2Fa.b',
      ],
    });
  });
});

describe('cardCreateView steps', () => {
  test('first, middle and last step', () => {
    const [a, b, c] = [
      view({}),
      view({ step: 'highlight' }),
      view({ step: 'cite' }),
    ];
    assert({
      given: 'each step',
      should:
        'mark one current and link back and forward only where they exist',
      actual: [a, b, c].map((v) => [
        v.steps.filter((step) => step.current).map((step) => step.label),
        v.backHref,
        v.nextHref,
      ]),
      expected: [
        [['Source'], null, '/prep/cards/new?step=highlight'],
        [['Highlight'], '/prep/cards/new', '/prep/cards/new?step=cite'],
        [['Cite and save'], '/prep/cards/new?step=highlight', null],
      ],
    });
  });

  test('source modes and the marking tool survive step changes', () => {
    const v = view({ src: 'link', tool: 'keep' });
    assert({
      given: 'the link mode with the keep tool',
      should: 'mark link current and carry both into the step links',
      actual: [
        v.sourceModes.find((mode) => mode.current)?.label,
        v.steps[1]?.href,
      ],
      expected: [
        'Import from link',
        '/prep/cards/new?step=highlight&src=link&tool=keep',
      ],
    });
  });
});

describe('cardCreateView content', () => {
  test('highlight words and read time come from the layers and pace', () => {
    const v = view({ step: 'highlight' });
    assert({
      given: 'the sample draft at 160 words a minute',
      should: 'count the read layer and show the pace in brackets',
      actual: [v.draft.readWords > 0, v.draft.readClock, v.paceLabel],
      expected: [true, '0:10', '[160]'],
    });
  });

  test('citation completeness and the missing-date notice', () => {
    const v = view({ step: 'cite' });
    assert({
      given: 'the sample citation with no date and no credibility note',
      should: 'count 5 of 7 and warn about the date',
      actual: [v.cite.completeness.filled, v.cite.notice?.title],
      expected: [5, 'The publication date is missing'],
    });
  });

  test('import outcomes become notices only in link mode', () => {
    assert({
      given: 'links of each kind, and the same address in paste mode',
      should: 'raise the matching notice, and none in paste mode',
      actual: [
        view({ src: 'link', url: 'https://x.org/unreachable' }).notice?.title,
        view({ src: 'link', url: 'https://x.org/login' }).notice?.title,
        view({ src: 'link', url: 'https://x.org/scan.pdf' }).notice?.title,
        view({ src: 'link', url: 'https://example.org/[source-path]' }).notice
          ?.title,
        view({ src: 'link', url: 'https://x.org/article' }).notice,
        view({ src: 'paste', url: 'https://x.org/unreachable' }).notice,
      ],
      expected: [
        'We could not open that page',
        'This page asks for a login',
        'This PDF is a scan with no selectable text',
        'You already have a card from this source',
        null,
        null,
      ],
    });
  });

  test('a fetched link fills the citation address', () => {
    assert({
      given: 'a fetched link',
      should: 'use it as the citation URL',
      actual: view({ step: 'cite', src: 'link', url: 'https://x.org/article' })
        .cite.fields.url,
      expected: 'https://x.org/article',
    });
  });
});
