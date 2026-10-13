import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { briefEditorView } from '../../../features/prep/briefs/brief-editor';
import { listBriefEvidence } from '../../../features/prep/briefs/brief-evidence';
import {
  getBrief,
  speechLimitSeconds,
} from '../../../features/prep/briefs/get-brief';
import { BriefEditor } from './brief-editor';

setupRitewayBun();

const render = (id: string) => {
  const brief = getBrief(id);
  if (brief === undefined) throw new Error(`no sample ${id}`);
  return renderToString(
    h(BriefEditor, {
      view: briefEditorView(
        brief,
        listBriefEvidence('2026-09-30T12:00:00.000Z'),
        160,
        speechLimitSeconds(),
      ),
    }),
  );
};

describe('BriefEditor', () => {
  test('the bar and the margins', () => {
    const html = render('rights-framework');
    assert({
      given: 'a saved brief',
      should:
        'trail to it, show the save state, outline every section with its cards, and search evidence beside the document',
      actual: [
        html.includes('aria-label="Breadcrumb"'),
        html.includes('Saved 12:04'),
        html.includes('aria-label="Outline"'),
        html.includes('>Overview<'),
        html.includes('>Anticipated responses<'),
        html.includes('aria-label="Evidence"'),
        html.includes('>Find evidence<'),
        html.includes(
          'Add “Cost estimates depend on assumed take-up” to the brief',
        ),
        html.includes('href="/prep/cards/new"'),
      ],
      expected: [true, true, true, true, true, true, true, true, true],
    });
  });

  test('time against the debate rules, over budget', () => {
    const html = render('rights-framework');
    assert({
      given: 'the sample brief at 160 words a minute',
      should: 'warn how far over it is and how much to cut',
      actual: [
        html.includes('aria-label="Time against the debate rules"'),
        /\d+:\d\d over · cut about \d+ words/.test(html),
        html.includes('Whole brief, read as one speech'),
        html.includes('160 words a minute'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('actions', () => {
    const html = render('rights-framework');
    assert({
      given: 'the editor bar',
      should:
        'answer save and add to case as sample actions, and link Share and Review to the review page',
      actual: [
        html.includes('href="/prep/briefs/rights-framework/review?share=open"'),
        html.includes('href="/prep/briefs/rights-framework/review"'),
        html.includes('href="?did=Add+to+case"'),
        html.includes('href="?did=Save+changes"'),
        html.includes('>Section<'),
      ],
      expected: [true, true, true, true, true],
    });
  });

  test('a new brief', () => {
    const html = render('new');
    assert({
      given: 'the blank brief',
      should:
        'say it is not saved, trail to New brief, and outline one section',
      actual: [
        html.includes('Not saved yet'),
        html.includes('>New brief<'),
        html.includes('>1 ·<'),
        html.includes('placeholder='),
      ],
      expected: [true, true, true, false],
    });
  });
});
