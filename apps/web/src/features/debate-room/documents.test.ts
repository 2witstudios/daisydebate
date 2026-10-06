import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  buildTemplate,
  createDocument,
  documentTemplates,
  nextOwnSpeech,
  renameDocument,
  uniqueTitle,
  updateDocumentContent,
  type DocJSON,
  type SpeechSlot,
  type TemplateContext,
} from './documents';

setupRitewayBun();

const slot = (
  id: string,
  side: SpeechSlot['side'],
  kind: SpeechSlot['kind'] = 'speech',
  durationMs = 300_000,
): SpeechSlot => ({ id, code: id.toUpperCase(), side, kind, durationMs });

const speeches = [
  slot('ac', 'aff', 'speech', 300_000),
  slot('cx1', 'neg', 'cross-ex', 180_000),
  slot('nc', 'neg', 'speech', 360_000),
  slot('1ar', 'aff', 'speech', 300_000),
];
const context: TemplateContext = { side: 'aff', speeches, title: '' };
const now = '2026-10-05T12:00:00.000Z';
const later = '2026-10-05T12:05:00.000Z';

const headings = (node: DocJSON): readonly string[] =>
  (node.content ?? []).flatMap((child) =>
    child.type === 'heading' ? [child.content?.[0]?.text ?? ''] : [],
  );
const types = (node: DocJSON) =>
  (node.content ?? []).map((child) => child.type);

describe('documentTemplates', () => {
  test('catalog', () => {
    assert({
      given: 'the template catalog',
      should: 'list every template id once',
      actual: documentTemplates.map((t) => t.id),
      expected: [
        'blank',
        'flow',
        'cross-ex',
        'speech-plan',
        'case',
        'block',
        'evidence',
      ],
    });
  });
});

describe('buildTemplate', () => {
  test('flow', () => {
    const flow = buildTemplate('flow', { ...context, title: 'Round flow' });
    assert({
      given: 'a flow for the aff',
      should:
        'title it and add one labelled section per speech, skipping cross-ex',
      actual: headings(flow),
      expected: ['Round flow', 'AC · Aff · You', 'NC · Neg', '1AR · Aff · You'],
    });
    assert({
      given: 'a flow',
      should: 'follow each section heading with an empty bullet list',
      actual: types(flow),
      expected: [
        'heading',
        'heading',
        'bulletList',
        'heading',
        'bulletList',
        'heading',
        'bulletList',
      ],
    });
  });

  test('cross-ex', () => {
    const cx = buildTemplate('cross-ex', context);
    assert({
      given: 'a cross-ex template without a title',
      should:
        'use the template title and a questions checklist plus admissions list',
      actual: { headings: headings(cx), types: types(cx) },
      expected: {
        headings: ['Cross-ex notes', 'Questions', 'Admissions'],
        types: ['heading', 'heading', 'taskList', 'heading', 'bulletList'],
      },
    });
  });

  test('speech-plan', () => {
    const plan = buildTemplate('speech-plan', { ...context, side: 'neg' });
    const rows = (plan.content?.[2]?.content ?? []).map(
      (item) => item.content?.[0]?.content?.[0]?.text,
    );
    assert({
      given: 'a speech plan for the neg',
      should: 'head it with the next own speech and its duration',
      actual: headings(plan),
      expected: ['Speech plan', 'NC · 6:00'],
    });
    assert({
      given: 'a six-minute speech',
      should: 'lay out timed rows',
      actual: rows,
      expected: ['0:00 Overview', '0:54 Line by line', '4:48 Voters'],
    });
    assert({
      given: 'no own speech left',
      should: 'fall back to a heading and an empty list',
      actual: types(buildTemplate('speech-plan', { ...context, speeches: [] })),
      expected: ['heading', 'bulletList'],
    });
  });

  test('speech-plan past the first own speech', () => {
    const round = [...speeches, slot('nr', 'neg', 'speech', 300_000)];
    const plan = buildTemplate('speech-plan', {
      ...context,
      side: 'neg',
      speeches: round,
      currentIndex: round.findIndex((s) => s.code === 'NC'),
    });
    assert({
      given: 'a neg speech plan once the NC is over',
      should: 'plan the next own speech, the NR',
      actual: headings(plan)[1]?.split(' · ')[0],
      expected: 'NR',
    });
  });

  test('plain templates', () => {
    assert({
      given: 'the evidence template',
      should: 'be a heading and an empty paragraph',
      actual: buildTemplate('evidence', context),
      expected: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: 'Evidence' }],
          },
          { type: 'paragraph' },
        ],
      },
    });
  });
});

describe('uniqueTitle', () => {
  test('numbering', () => {
    assert({
      given: 'a free title',
      should: 'keep it',
      actual: uniqueTitle('Flow', ['Case']),
      expected: 'Flow',
    });
    assert({
      given: 'a taken title and its second copy',
      should: 'pick the next number',
      actual: uniqueTitle('Flow', ['Flow', 'Flow 2']),
      expected: 'Flow 3',
    });
  });
});

describe('createDocument', () => {
  const input = {
    id: 'doc-1',
    now,
    folder: 'round' as const,
    templateId: 'flow' as const,
    existingTitles: ['Flow'],
    context,
  };

  test('without a title', () => {
    const created = createDocument(input);
    assert({
      given: 'a second flow with no title',
      should: 'name it "Flow 2" and stamp both times',
      actual: [
        created.title,
        created.createdAt,
        created.updatedAt,
        created.folder,
      ],
      expected: ['Flow 2', now, now, 'round'],
    });
    assert({
      given: 'the generated title',
      should: 'use it as the document heading',
      actual: headings(created.content)[0],
      expected: 'Flow 2',
    });
  });

  test('with a title', () => {
    assert({
      given: 'an explicit padded title',
      should: 'trim it',
      actual: createDocument({ ...input, title: '  Their case  ' }).title,
      expected: 'Their case',
    });
  });
});

describe('editing', () => {
  const created = createDocument({
    id: 'doc-1',
    now,
    folder: 'library',
    templateId: 'blank',
    existingTitles: [],
    context,
  });

  test('updateDocumentContent', () => {
    const content: DocJSON = { type: 'doc', content: [] };
    assert({
      given: 'new content',
      should: 'replace it and bump updatedAt',
      actual: updateDocumentContent(created, content, later),
      expected: { ...created, content, updatedAt: later },
    });
  });

  test('renameDocument', () => {
    assert({
      given: 'a padded new title',
      should: 'trim it and bump updatedAt',
      actual: renameDocument(created, ' Notes ', later),
      expected: { ...created, title: 'Notes', updatedAt: later },
    });
    assert({
      given: 'a blank title',
      should: 'return the document unchanged',
      actual: renameDocument(created, '   ', later),
      expected: created,
    });
  });
});

describe('nextOwnSpeech', () => {
  test('search', () => {
    assert({
      given: 'the aff after the first speech',
      should: 'find the 1AR',
      actual: nextOwnSpeech(speeches, 'aff', 0)?.id,
      expected: '1ar',
    });
    assert({
      given: 'the neg with only cross-ex slots ahead',
      should: 'skip cross-ex and return null when nothing is left',
      actual: nextOwnSpeech(speeches, 'neg', 2),
      expected: null,
    });
  });
});
