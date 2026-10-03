import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { parseCaseQuery } from '../../../features/prep/case-query';
import { caseView } from '../../../features/prep/case-view';
import { getCase } from '../../../features/prep/get-case';
import { CasePage } from './case-page';

setupRitewayBun();

const render = (id: string, params: Record<string, string | string[]> = {}) => {
  const found = getCase(id);
  if (found === undefined) throw new Error(`no sample ${id}`);
  return renderToString(
    h(CasePage, {
      view: caseView(
        found,
        parseCaseQuery(params),
        160,
        360,
        '2026-09-30T12:00:00.000Z',
      ),
    }),
  );
};

describe('CasePage compose', () => {
  const html = render('aff-rights');
  test('header, tabs, speech and rails', () => {
    assert({
      given: 'the sample case',
      should:
        'show one h1, the draft badge, the sharing line, view and speech tabs, blocks, the library and versions',
      actual: [
        html.match(/<h1 /g)?.length,
        html.includes('Draft on v4'),
        html.includes('Shared with [Team name]: can comment'),
        html.includes('href="/prep/cases/aff-rights?view=compare"'),
        html.includes('href="/prep/cases/aff-rights?speech=s2"'),
        html.includes('Over [speech time] by ['),
        html.includes('aria-label="Add from your library"'),
        html.includes('Save as v5'),
        html.includes('Unsaved changes:'),
      ],
      expected: [1, true, true, true, true, true, true, true, true],
    });
  });

  test('block controls are named sample actions', () => {
    assert({
      given: 'the block rows',
      should:
        'name the move and remove controls and answer them as sample actions',
      actual: [
        html.includes('aria-label="Move up"'),
        html.includes('aria-label="Remove from speech"'),
        html.includes(
          'aria-label="Add Framing pack: burden and standards to speech"',
        ),
        html.includes('href="?did=Move+up"'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('a case with a deleted card', () => {
    const gone = render('neg-costs-first');
    assert({
      given: 'a case holding a deleted card',
      should:
        'raise the deleted-card notice, keep the slot, and show no draft badge',
      actual: [
        gone.includes('A card in this case was deleted'),
        gone.includes('Card deleted · slot kept'),
        gone.includes('Draft on'),
      ],
      expected: [true, true, false],
    });
  });
});

describe('CasePage compare', () => {
  test('the diff', () => {
    const html = render('aff-rights', {
      view: 'compare',
      from: '3',
      to: 'draft',
    });
    assert({
      given: 'v3 against the draft',
      should:
        'show the change chips, the speech groups, the word-level edit and the restore button',
      actual: [
        html.includes('3 added'),
        html.includes('1 removed'),
        html.includes('1 moved'),
        html.includes('1 edited'),
        html.includes('[Speech 2]'),
        /<del[^>]*> ?outweigh<\/del>/.test(html),
        /<ins[^>]*> ?defeat<\/ins>/.test(html),
        html.includes('Restore v3 as a new version'),
        html.includes('Restoring never deletes anything.'),
      ],
      expected: [true, true, true, true, true, true, true, true, true],
    });
  });

  test('the compare form is a GET', () => {
    const html = render('aff-rights', { view: 'compare' });
    assert({
      given: 'the version pickers',
      should: 'be a GET form keeping the compare view',
      actual: [
        /<form [^>]*method="get"/.test(html),
        html.includes('name="view" value="compare"'),
        html.includes('name="from"'),
        html.includes('name="to"'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('two identical picks', () => {
    const html = render('aff-rights', { view: 'compare', from: '4', to: '4' });
    assert({
      given: 'v4 against v4',
      should: 'say nothing changed',
      actual: html.includes('Nothing changed between them.'),
      expected: true,
    });
  });
});

describe('CasePage export', () => {
  test('formats, options and the file-you-hold warning', () => {
    const html = render('aff-rights', { view: 'export' });
    assert({
      given: 'the export view',
      should:
        'offer three formats as links, the options as a GET form, a preview and export actions that answer as sample actions',
      actual: [
        html.includes('href="/prep/cases/aff-rights?view=export&amp;fmt=flow"'),
        html.match(/type="checkbox"/g)?.length,
        html.includes('name="set" value="1"'),
        html.includes('[SPEECH 1] · [SPEECH TIME]'),
        html.includes('An export is a file you hold'),
        html.match(/href="\?did=(Export\+PDF|Print|Copy\+as\+text)"/g)?.length,
      ],
      expected: [true, 5, true, true, true, 3],
    });
  });
});
