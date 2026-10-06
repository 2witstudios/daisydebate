import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleRound } from '../mock/debate-room';
import { appendBullets, initialRoomState, reduceRoom } from './room-state';

setupRitewayBun();

const now = '2026-10-05T18:30:00.000Z';
const practice = sampleRound('prep', 'unrated');
const rated = sampleRound('prep', 'rated');

describe('initialRoomState', () => {
  test('opens the round folder', () => {
    const state = initialRoomState(practice);
    assert({
      given: 'a round with three round documents',
      should: 'open each as a tab and show the first',
      actual: state.tabs,
      expected: { open: ['doc-flow', 'doc-cx', 'doc-nr'], active: 'doc-flow' },
    });
  });
});

describe('reduceRoom doc/create', () => {
  test('a new document from the palette', () => {
    const reduce = reduceRoom(practice);
    const state = reduce(
      { ...initialRoomState(practice), paletteOpen: true },
      {
        type: 'doc/create',
        id: 'doc-new',
        now,
        templateId: 'flow',
        folder: 'round',
      },
    );
    assert({
      given: 'a flow created while a Flow exists',
      should: 'add it under a unique title, open it and close the palette',
      actual: {
        title: state.documents.at(-1)?.title,
        active: state.tabs.active,
        paletteOpen: state.paletteOpen,
      },
      expected: { title: 'Flow 2', active: 'doc-new', paletteOpen: false },
    });
  });
});

describe('reduceRoom agent/edit', () => {
  const reduce = reduceRoom(practice);
  const apply = {
    type: 'agent/edit',
    turnId: 'a2',
    outcome: 'applied',
    documentId: 'doc-nr',
    lines: ['0:15 extra time on N2 weighing'],
    now,
  } as const;

  test('applying an edit', () => {
    const before = initialRoomState(practice);
    const after = reduce(before, apply);
    const doc = after.documents.find((d) => d.id === 'doc-nr');
    assert({
      given: 'an agent edit applied to the NR plan',
      should: 'append its lines, record the outcome and open the document',
      actual: {
        blocks: doc?.content.content?.length,
        outcome: after.edits.a2,
        active: after.tabs.active,
        updatedAt: doc?.updatedAt,
      },
      expected: {
        blocks:
          (before.documents.find((d) => d.id === 'doc-nr')?.content.content
            ?.length ?? 0) + 1,
        outcome: 'applied',
        active: 'doc-nr',
        updatedAt: now,
      },
    });
  });

  test('a decided edit is final', () => {
    const once = reduce(initialRoomState(practice), apply);
    assert({
      given: 'the same edit applied twice',
      should: 'leave the state as the first application left it',
      actual: reduce(once, apply),
      expected: once,
    });
  });

  test('discarding an edit', () => {
    const before = initialRoomState(practice);
    const after = reduce(before, { ...apply, outcome: 'discarded' });
    assert({
      given: 'an agent edit discarded',
      should: 'record it and leave the documents untouched',
      actual: { outcome: after.edits.a2, documents: after.documents },
      expected: { outcome: 'discarded', documents: before.documents },
    });
  });
});

describe('reduceRoom sidebar/tab', () => {
  test('a rated round has no AI tab', () => {
    const before = initialRoomState(rated);
    assert({
      given: 'a request for the AI tab in a rated round',
      should: 'stay on chat',
      actual: reduceRoom(rated)(before, { type: 'sidebar/tab', tab: 'ai' })
        .sidebar,
      expected: 'chat',
    });
  });
});

describe('appendBullets', () => {
  test('no lines', () => {
    const content = { type: 'doc', content: [] };
    assert({
      given: 'no lines to add',
      should: 'return the content unchanged',
      actual: appendBullets(content, []),
      expected: content,
    });
  });
});
