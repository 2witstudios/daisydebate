import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { emptyBrief, sampleBriefs } from '../../../ui/mock/prep-briefs';
import {
  briefHtml,
  briefOutline,
  evidenceHtml,
  findEvidence,
  withSection,
  type BriefEvidence,
} from './brief-document';
import { listBriefEvidence } from './brief-evidence';

setupRitewayBun();

const now = '2026-09-30T12:00:00.000Z';
const evidence = listBriefEvidence(now);
const [rights] = sampleBriefs;
if (rights === undefined) throw new Error('no sample brief');

describe('briefHtml', () => {
  test('a saved brief', () => {
    const html = briefHtml(rights, evidence);
    assert({
      given: 'the rights-framework brief and the owner’s evidence',
      should:
        'open with the title and motion line, then overview, three contentions and responses, with card passages',
      actual: [
        html.startsWith(
          '<h1>Affirmative case: rights-based framework</h1><p>[Motion A] · Aff</p><h2>Overview</h2>',
        ),
        html.match(/<h2>/g)?.length,
        html.includes('<h2>2 · Costs do not defeat a rights claim</h2>'),
        html.includes(
          '<blockquote><p><strong>Cost estimates depend on assumed take-up</strong></p><p>[Author A] [year]</p><p>[The passage',
        ),
        html.includes(
          '<h2>Anticipated responses</h2><p><strong>They say</strong>',
        ),
      ],
      expected: [true, 5, true, true, true],
    });
  });

  test('a new brief and hostile text', () => {
    assert({
      given: 'the blank brief, and a card whose text carries markup',
      should: 'make an empty title and one empty section, and escape the text',
      actual: [
        briefHtml(emptyBrief, evidence),
        evidenceHtml({ title: '<b>x</b>', cite: 'a & b', passage: '' }),
      ],
      expected: [
        '<h1></h1><h2>1 · </h2>',
        '<blockquote><p><strong>&lt;b&gt;x&lt;/b&gt;</strong></p><p>a &amp; b</p></blockquote>',
      ],
    });
  });
});

describe('briefOutline', () => {
  const html =
    '<h1>T</h1><p>not spoken</p><h2>Overview</h2><p>one two three four</p><h2>1 · Costs</h2><p>five &amp; six</p><blockquote><p>seven</p></blockquote><h2></h2>';

  test('sections, cards and time', () => {
    const outline = briefOutline(html, 60, 5);
    assert({
      given:
        'a document with three sections at 60 words a minute and a 5 second limit',
      should:
        'label each h2, count its words and cards, and time the whole against the limit',
      actual: outline,
      expected: {
        sections: [
          { index: 0, label: 'Overview', cards: 0, words: 4, clock: '0:04' },
          { index: 1, label: '1 · Costs', cards: 1, words: 4, clock: '0:04' },
          { index: 2, label: 'Section 3', cards: 0, words: 0, clock: '0:00' },
        ],
        cards: 1,
        words: 8,
        clock: '0:08',
        budget: { over: true, deltaSeconds: 3, percent: 100 },
        overClock: '0:03',
        trimWords: 3,
      },
    });
  });

  test('adding a section', () => {
    const outline = briefOutline(html, 60, 5);
    assert({
      given: 'a document with one numbered section',
      should: 'append section 2, empty',
      actual: withSection('<h2>1 · Costs</h2>', outline).endsWith(
        '<h2>2 · </h2><p></p>',
      ),
      expected: true,
    });
  });
});

describe('evidence', () => {
  test('the owner’s cards and search', () => {
    const owners = new Set(evidence.map((card: BriefEvidence) => card.owner));
    assert({
      given: 'the sample library and two searches',
      should:
        'list every card with its owner, and keep only cards holding every word',
      actual: [
        evidence.length,
        owners.has('Mine'),
        findEvidence(evidence, 'COST take-up').map((card) => card.id),
        findEvidence(evidence, '').length,
      ],
      expected: [5, true, ['cost-estimates'], 5],
    });
  });
});
