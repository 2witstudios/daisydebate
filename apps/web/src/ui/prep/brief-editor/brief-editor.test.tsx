import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { briefEditorView } from '../../../features/prep/briefs/brief-editor';
import {
  getBrief,
  speechLimitSeconds,
} from '../../../features/prep/briefs/get-brief';
import { BriefEditor } from './brief-editor';

setupRitewayBun();

const render = (id: string, section = '') => {
  const brief = getBrief(id);
  if (brief === undefined) throw new Error(`no sample ${id}`);
  return renderToString(
    h(BriefEditor, {
      view: briefEditorView(brief, { section }, 160, speechLimitSeconds()),
    }),
  );
};

describe('BriefEditor', () => {
  test('contention 1 by default', () => {
    const html = render('rights-framework');
    assert({
      given: 'a saved brief',
      should:
        'name the brief in an input, outline every section, show the open contention and its fields',
      actual: [
        html.includes('aria-label="Outline"') || html.includes('>Outline<'),
        /value="Affirmative case: rights-based framework"/.test(html),
        html.includes('Contention 1'),
        html.includes('for="wa-c1"'),
        html.includes('Last saved 12:04'),
        html.includes('aria-label="Add contention"'),
        html.includes('Anticipated responses'),
        html.includes('Find in library'),
      ],
      expected: [true, true, true, true, true, true, true, true],
    });
  });

  test('outline entries are links that mark the open one', () => {
    const html = render('rights-framework', 'c2');
    assert({
      given: 'contention 2 open',
      should: 'link the outline with section params and mark one current',
      actual: [
        html.includes('href="/prep/briefs/rights-framework?section=c3"'),
        html.includes('href="/prep/briefs/rights-framework?section=responses"'),
        html.match(/aria-current="page"/g)?.length,
        html.includes('for="wa-c2"'),
      ],
      expected: [true, true, 2, true],
    });
  });

  test('time against the debate rules, over budget', () => {
    const html = render('rights-framework');
    assert({
      given: 'the sample brief',
      should: 'warn how far over it is and how much to cut',
      actual: [
        html.includes('Time against the debate rules'),
        /\d+:\d\d over · cut about \d+ words/.test(html),
        html.includes('Whole brief, read as one speech'),
        html.includes('160 words a minute'),
        html.includes('Framing'),
      ],
      expected: [true, true, true, true, true],
    });
  });

  test('framing and responses sections', () => {
    const framing = render('rights-framework', 'framing');
    const responses = render('rights-framework', 'responses');
    assert({
      given: 'the framing and responses sections',
      should: 'show the motion and burden fields, and the grouped responses',
      actual: [
        framing.includes('Resolved: [motion text]'),
        framing.includes('for="burden"'),
        framing.includes('Value') || framing.includes('Criterion'),
        responses.includes('Contention 2'),
        responses.includes('They say'),
      ],
      expected: [true, true, false, true, true],
    });
  });

  test('mutations are sample actions; Share goes to the review page', () => {
    const html = render('rights-framework');
    assert({
      given: 'the editor header',
      should:
        'answer save and add to case as sample actions, and link Share to the share dialog',
      actual: [
        html.includes('href="/prep/briefs/rights-framework/review?share=open"'),
        html.includes('href="?did=Add+to+case"'),
        html.includes('href="?did=Save+changes"'),
      ],
      expected: [true, true, true],
    });
  });

  test('a new brief', () => {
    const html = render('new');
    assert({
      given: 'the blank brief',
      should: 'say it is not saved, start on framing and show an empty title',
      actual: [
        html.includes('Not saved yet'),
        html.includes('Motion and framing'),
        html.includes('New brief'),
        html.includes('placeholder="Name this brief"'),
      ],
      expected: [true, true, true, true],
    });
  });
});
