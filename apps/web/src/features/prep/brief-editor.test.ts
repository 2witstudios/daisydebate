import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  briefEditorView,
  briefHref,
  parseBriefEditorQuery,
} from './brief-editor';
import { speechLimitSeconds } from './get-brief';
import { requireBrief } from './brief.test-support';

setupRitewayBun();

const view = (id: string, section = '') =>
  briefEditorView(requireBrief(id), { section }, 160, speechLimitSeconds());

describe('parseBriefEditorQuery', () => {
  test('values and junk', () => {
    assert({
      given: 'a section, nothing, and junk',
      should: 'keep a clean id and blank out the rest',
      actual: [
        parseBriefEditorQuery({ section: 'c2' }),
        parseBriefEditorQuery({}),
        parseBriefEditorQuery({ section: '../x' }),
        parseBriefEditorQuery({ section: 'a'.repeat(40) }),
      ],
      expected: [
        { section: 'c2' },
        { section: '' },
        { section: '' },
        { section: '' },
      ],
    });
  });

  test('hrefs', () => {
    assert({
      given: 'a blank and a named section',
      should: 'omit the query for blank',
      actual: [briefHref('b', ''), briefHref('b', 'c2')],
      expected: ['/prep/briefs/b', '/prep/briefs/b?section=c2'],
    });
  });
});

describe('briefEditorView', () => {
  test('default section and outline', () => {
    const v = view('rights-framework');
    assert({
      given: 'a saved brief with no section asked',
      should:
        'open contention 1 and outline framing, three contentions and responses',
      actual: [
        v.section.kind,
        v.outline.map((o) => [o.id, o.current]),
        v.savedLabel,
        v.sideLabel,
        v.outline.at(-1)?.detail,
      ],
      expected: [
        'contention',
        [
          ['framing', false],
          ['c1', true],
          ['c2', false],
          ['c3', false],
          ['responses', false],
        ],
        'Last saved 12:04',
        'Aff',
        '4 responses',
      ],
    });
  });

  test('framing, responses and an unknown section', () => {
    assert({
      given: 'the framing, responses and a bad section',
      should: 'resolve each; the bad one falls back to contention 1',
      actual: [
        view('rights-framework', 'framing').section.kind,
        view('rights-framework', 'responses').section.kind,
        view('rights-framework', 'c9').section.kind,
      ],
      expected: ['framing', 'responses', 'contention'],
    });
  });

  test('the responses are grouped by contention', () => {
    const v = view('rights-framework', 'responses');
    assert({
      given: 'the responses section',
      should: 'group by contention, skipping those with none',
      actual:
        v.section.kind === 'responses'
          ? v.section.groups.map((g) => [g.label, g.responses.length])
          : null,
      expected: [
        ['Contention 1', 1],
        ['Contention 2', 2],
        ['Contention 3', 1],
      ],
    });
  });

  test('time against the limit', () => {
    const v = view('rights-framework');
    assert({
      given: 'the sample brief at 160 words a minute',
      should: 'read it as one speech, go over the limit and suggest a trim',
      actual: [
        v.time.budget.over,
        v.time.trimWords > 0,
        v.paceLabel,
        v.time.sections.length,
      ],
      expected: [true, true, '[160]', 4],
    });
  });

  test('a new brief', () => {
    const v = view('new');
    assert({
      given: 'the blank brief',
      should: 'start on framing, be unsaved, and have no time',
      actual: [
        v.section.kind,
        v.savedLabel,
        v.time.whole.clock,
        v.time.budget.over,
      ],
      expected: ['framing', 'Not saved yet', '0:00', false],
    });
  });

  test('share and review links', () => {
    assert({
      given: 'a brief',
      should: 'link to its review page, and its share dialog',
      actual: [view('framing-pack').reviewHref, view('framing-pack').shareHref],
      expected: [
        '/prep/briefs/framing-pack/review',
        '/prep/briefs/framing-pack/review?share=open',
      ],
    });
  });
});
