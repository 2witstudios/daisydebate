import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { briefOutline } from './brief-document';
import { briefEditorView } from './brief-editor';
import { listBriefEvidence } from './brief-evidence';
import { requireBrief } from './brief.test-support';

setupRitewayBun();

const evidence = listBriefEvidence('2026-09-30T12:00:00.000Z');
const view = (id: string) =>
  briefEditorView(requireBrief(id), evidence, 160, 300);

describe('briefEditorView', () => {
  test('a saved team brief', () => {
    const v = view('rights-framework');
    const outline = briefOutline(v.html, v.pace, v.limitSeconds);
    assert({
      given: 'a saved brief shared with a team, at 160 words a minute',
      should:
        'carry its document, saved time and access, and read over the limit',
      actual: [
        v.title,
        v.savedLabel,
        v.accessLabel,
        outline.sections.map((s) => s.label.slice(0, 12)),
        outline.budget.over,
        v.evidence.length,
      ],
      expected: [
        'Affirmative case: rights-based framework',
        'Saved 12:04',
        'Shared with [Team name]',
        [
          'Overview',
          '1 · The fram',
          '2 · Costs do',
          '3 · Implemen',
          'Anticipated ',
        ],
        true,
        5,
      ],
    });
  });

  test('a new brief', () => {
    const v = view('new');
    assert({
      given: 'the blank brief',
      should: 'be unsaved, private, and read no time',
      actual: [
        v.savedLabel,
        v.accessLabel,
        briefOutline(v.html, v.pace, v.limitSeconds).clock,
      ],
      expected: ['Not saved yet', 'Private to you', '0:00'],
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
