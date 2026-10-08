import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { previewLines } from './case-export';
import { caseHref, parseCaseQuery } from './case-query';
import { caseView } from './case-view';
import { getCase } from './get-case';

setupRitewayBun();

const now = '2026-09-30T12:00:00.000Z';
const sample = (id: string) => {
  const found = getCase(id);
  if (found === undefined) throw new Error(`no sample ${id}`);
  return found;
};
const view = (id: string, params: Record<string, string | string[]> = {}) =>
  caseView(sample(id), parseCaseQuery(params), 160, 360, now);

describe('parseCaseQuery', () => {
  test('defaults, values and junk', () => {
    assert({
      given: 'nothing, valid values, and junk',
      should: 'parse or fall back; options default until the form is submitted',
      actual: [
        parseCaseQuery({}),
        parseCaseQuery({
          view: 'export',
          fmt: 'flow',
          set: '1',
          opt: ['notes', 'bogus', 'notes'],
        }),
        parseCaseQuery({ view: 'x', speech: '../../', fmt: 'pdf' }),
      ],
      expected: [
        {
          view: 'compose',
          speech: '',
          from: '',
          to: '',
          fmt: 'speech',
          optionsSet: false,
          opts: ['cite', 'break', 'large'],
          q: '',
        },
        {
          view: 'export',
          speech: '',
          from: '',
          to: '',
          fmt: 'flow',
          optionsSet: true,
          opts: ['notes'],
          q: '',
        },
        {
          view: 'compose',
          speech: '',
          from: '',
          to: '',
          fmt: 'speech',
          optionsSet: false,
          opts: ['cite', 'break', 'large'],
          q: '',
        },
      ],
    });
  });

  test('hrefs omit defaults', () => {
    assert({
      given: 'a compare state and the default',
      should: 'carry only the non-defaults',
      actual: [
        caseHref('c', {}),
        caseHref('c', { view: 'compare', from: '3', to: 'draft' }),
        caseHref('c', {
          view: 'export',
          fmt: 'cards',
          optionsSet: true,
          opts: ['cite'],
        }),
      ],
      expected: [
        '/prep/cases/c',
        '/prep/cases/c?view=compare&from=3&to=draft',
        '/prep/cases/c?view=export&fmt=cards&set=1&opt=cite',
      ],
    });
  });
});

describe('caseView compose', () => {
  test('speeches, times and blocks', () => {
    const v = view('aff-rights');
    assert({
      given: 'the sample case with a draft',
      should:
        'tab the speeches, mark the first, time it against the limit and list its blocks',
      actual: [
        v.speechTabs.map((t) => [t.label, t.current]),
        v.speechTime.budget.over,
        v.blocks.map((b) => b.title),
        v.blocks[0]?.clock,
        v.nextVersion,
      ],
      expected: [
        [
          ['[Speech 1]', true],
          ['[Speech 2]', false],
          ['[Speech 3]', false],
        ],
        true,
        [
          'Framing',
          'Contention 1',
          'Card: The framework applies to institutions…',
          'Contention 2',
          'Transition note',
        ],
        '1:08',
        5,
      ],
    });
  });

  test('a chosen speech', () => {
    assert({
      given: 'speech s3 asked for',
      should: 'show that speech',
      actual: view('aff-rights', { speech: 's3' }).speech.label,
      expected: '[Speech 3]',
    });
  });

  test('the version rail', () => {
    const v = view('aff-rights');
    assert({
      given: 'a case with a draft and four saved versions',
      should: 'lead with the unsaved draft and link each row to a compare',
      actual: [
        v.versions.map((r) => r.tag),
        v.versions[0]?.draft,
        v.versions[1]?.compareHref,
        v.versions[0]?.title.startsWith('Unsaved changes: '),
      ],
      expected: [
        ['v4', 'v4', 'v3', 'v2', 'v1'],
        true,
        '/prep/cases/aff-rights?view=compare&from=4&to=draft',
        true,
      ],
    });
  });

  test('a deleted card keeps its slot', () => {
    const v = view('neg-costs-first');
    assert({
      given: 'a case holding a deleted card',
      should: 'flag it and keep the row',
      actual: [
        v.hasRemovedCard,
        v.blocks.find((b) => b.removed)?.title,
        v.versions[0]?.draft,
      ],
      expected: [true, 'Card removed from your library', false],
    });
  });

  test('library sources follow the search', () => {
    assert({
      given: 'a search for framing',
      should: 'offer the two briefs tagged framing',
      actual: view('aff-rights', { q: 'framing' }).sources.map((s) => s.id),
      expected: ['framing-pack', 'opening-statements'],
    });
  });
});

describe('caseView compare', () => {
  test('defaults to the previous version against the draft', () => {
    const v = view('aff-rights', { view: 'compare' });
    assert({
      given: 'compare with nothing chosen',
      should: 'pick v3 against the current unsaved draft and count changes',
      actual: [
        v.compare.from,
        v.compare.to,
        v.compare.diff.counts,
        v.compare.restoreVersion,
      ],
      expected: ['3', 'draft', { add: 3, remove: 1, move: 1, edit: 1 }, 3],
    });
  });

  test('two saved versions', () => {
    const v = view('aff-rights', { view: 'compare', from: '3', to: '4' });
    assert({
      given: 'v3 against v4',
      should: 'find the moved contention',
      actual: v.compare.diff.counts,
      expected: { add: 0, remove: 0, move: 1, edit: 0 },
    });
  });
});

describe('caseView export', () => {
  test('formats, options and the preview', () => {
    const v = view('aff-rights', { view: 'export', fmt: 'cards' });
    assert({
      given: 'the cards packet with default options',
      should: 'mark the format, check three options and preview only cards',
      actual: [
        v.export.choices.filter((c) => c.current).map((c) => c.label),
        v.export.settings.filter((s) => s.checked).map((s) => s.id),
        v.export.preview,
      ],
      expected: [
        ['Cards packet'],
        ['cite', 'break', 'large'],
        [
          '[SPEECH 1]',
          'Card: The framework applies to institutions…',
          'Full citation under each card',
        ],
      ],
    });
  });

  test('private notes only when asked', () => {
    const speech = sample('aff-rights').versions[0]!.speeches[0]!;
    assert({
      given: 'options with and without private notes',
      should: 'mention them only when on',
      actual: [
        previewLines('speech', [], speech).includes('Private notes included'),
        previewLines('speech', ['notes'], speech).includes(
          'Private notes included',
        ),
      ],
      expected: [false, true],
    });
  });
});
