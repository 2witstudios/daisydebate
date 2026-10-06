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
        added: doc?.html.endsWith(
          '<ul><li><p>0:15 extra time on N2 weighing</p></li></ul>',
        ),
        outcome: after.edits.a2,
        active: after.tabs.active,
        updatedAt: doc?.updatedAt,
      },
      expected: {
        added: true,
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
    assert({
      given: 'no lines to add',
      should: 'return the document unchanged',
      actual: appendBullets('<p>a</p>', []),
      expected: '<p>a</p>',
    });
  });

  test('escaping', () => {
    assert({
      given: 'a line with markup characters',
      should: 'escape it inside a new bullet',
      actual: appendBullets('<p>a</p>', ['<b>x</b>']),
      expected: '<p>a</p><ul><li><p>&lt;b&gt;x&lt;/b&gt;</p></li></ul>',
    });
  });
});

describe('reduceRoom doc/loaded and doc/add', () => {
  const reduce = reduceRoom(practice);
  const flow = practice.documents.find((d) => d.id === 'doc-flow')!;

  test('the server’s documents arrive', () => {
    const empty = { ...initialRoomState({ ...practice, documents: [] }) };
    const state = reduce(empty, { type: 'doc/loaded', documents: [flow] });
    assert({
      given: 'a room with no documents loading the server’s',
      should: 'hold them and open the round documents',
      actual: { ids: state.documents.map((d) => d.id), tabs: state.tabs },
      expected: {
        ids: ['doc-flow'],
        tabs: { open: ['doc-flow'], active: 'doc-flow' },
      },
    });
  });

  test('a document the server created', () => {
    const state = reduce(
      { ...initialRoomState(practice), paletteOpen: true },
      {
        type: 'doc/add',
        document: { ...flow, id: 'doc-new', title: 'Flow 2' },
      },
    );
    assert({
      given: 'a document created on the server',
      should: 'add it, open it and close the palette',
      actual: { active: state.tabs.active, paletteOpen: state.paletteOpen },
      expected: { active: 'doc-new', paletteOpen: false },
    });
  });
});
