import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  initialManagerState,
  reduceManager,
  type ManagerAction,
  type ManagerState,
} from './document-manager-state';
import { loadedDocuments } from './open-documents';
import type { MemberDocument } from './document';

setupRitewayBun();
const document: MemberDocument = {
  id: 'd'.repeat(24),
  title: 'Notes',
  html: '<p>saved</p>',
  createdAt: '2026-10-09T00:00:00.000Z',
  updatedAt: '2026-10-09T00:00:00.000Z',
};
const shown = (state: ManagerState, id: string) =>
  loadedDocuments(state.opened).find((doc) => doc.id === id)?.html;

test('a load opens what was edited last, and never replaces a loaded document', () => {
  const loaded = reduceManager(initialManagerState(), {
    type: 'doc/loaded',
    documents: [document],
  });
  const typed = reduceManager(loaded, {
    type: 'doc/update',
    id: document.id,
    html: '<p>typed</p>',
    now: 'n',
  });
  const later = reduceManager(typed, {
    type: 'doc/loaded',
    documents: [{ ...document, html: '<p>an older read</p>' }],
  });
  assert({
    given: 'a loaded document, typing, then a read arriving',
    should: 'open it, and keep what was typed',
    actual: [later.tabs.active, shown(later, document.id)],
    expected: [document.id, '<p>typed</p>'],
  });
});

test('no body exists until the document has loaded', () => {
  const opening = reduceManager(initialManagerState(), {
    type: 'doc/opening',
    id: document.id,
    title: 'Notes',
  });
  const typedEarly = reduceManager(opening, {
    type: 'doc/update',
    id: document.id,
    html: '<p>no editor exists</p>',
    now: 'n',
  });
  const arrived = reduceManager(typedEarly, { type: 'doc/add', document });
  assert({
    given: 'a document opening, then its body arriving',
    should: 'hold a tab with no body, then the server’s body',
    actual: [
      opening.tabs.active,
      opening.opened[0]?.kind,
      shown(typedEarly, document.id),
      arrived.opened.map((open) => open.kind),
      shown(arrived, document.id),
    ],
    expected: [document.id, 'loading', undefined, ['loaded'], '<p>saved</p>'],
  });
});

test('a failed open says so and can be asked again', () => {
  const opening = reduceManager(initialManagerState(), {
    type: 'doc/opening',
    id: document.id,
    title: 'Notes',
  });
  const failed = reduceManager(opening, {
    type: 'doc/failed',
    id: document.id,
  });
  const again = reduceManager(failed, {
    type: 'doc/opening',
    id: document.id,
    title: 'Notes',
  });
  assert({
    given: 'an open that failed, then a retry',
    should: 'go from failed back to loading, in one entry',
    actual: [failed.opened[0]?.kind, again.opened.map((open) => open.kind)],
    expected: ['failed', ['loading']],
  });
});

test('asking for a loaded document again changes nothing about it', () => {
  const loaded = reduceManager(initialManagerState(), {
    type: 'doc/add',
    document,
  });
  const again = reduceManager(loaded, {
    type: 'doc/opening',
    id: document.id,
    title: 'Notes',
  });
  assert({
    given: 'a loaded document opened again',
    should: 'stay loaded',
    actual: again.opened.map((open) => open.kind),
    expected: ['loaded'],
  });
});

test('a document opening keeps its place when a load answers for another', () => {
  const clicked = { ...document, id: 'c'.repeat(24), title: 'Clicked' };
  const opening = reduceManager(initialManagerState(), {
    type: 'doc/opening',
    id: clicked.id,
    title: clicked.title,
  });
  const loaded = reduceManager(opening, {
    type: 'doc/loaded',
    documents: [document],
  });
  assert({
    given: 'a click that beat the load',
    should: 'keep the clicked tab active, still loading',
    actual: [loaded.tabs.active, loaded.opened.map((open) => open.kind)],
    expected: [clicked.id, ['loading', 'loaded']],
  });
  const withdrawn = reduceManager(loaded, { type: 'doc/withdrawn' });
  assert({
    given: 'the owner closing',
    should: 'leave nothing on screen',
    actual: [withdrawn.opened, withdrawn.tabs.open],
    expected: [[], []],
  });
});

test('a body arriving leaves the person where they are', () => {
  const other = { ...document, id: 'b'.repeat(24), title: 'Other' };
  const reading = reduceManager(
    reduceManager(initialManagerState(), { type: 'doc/add', document: other }),
    { type: 'doc/opening', id: document.id, title: 'Notes' },
  );
  const movedBack = reduceManager(reading, {
    type: 'tabs/activate',
    id: other.id,
  });
  const arrived = reduceManager(movedBack, { type: 'doc/add', document });
  const closed = reduceManager(reading, {
    type: 'tabs/close',
    id: document.id,
  });
  const late = reduceManager(closed, { type: 'doc/add', document });
  assert({
    given:
      'a person back on another tab, and one who closed the tab, when the read answers',
    should: 'not move them, and not reopen the tab',
    actual: [arrived.tabs.active, late.tabs.open.includes(document.id)],
    expected: [other.id, false],
  });
});

const runActions = (
  actions: readonly ManagerAction[],
  from = initialManagerState(),
) => actions.reduce<ManagerState>(reduceManager, from);

describe('reduceManager: the palette', () => {
  test('its modes', () => {
    assert({
      given: 'the + and then Esc',
      should: 'open what can be made, and close',
      actual: [
        initialManagerState().palette,
        runActions([{ type: 'palette/open', mode: 'create' }]).palette,
        runActions([
          { type: 'palette/open', mode: 'create' },
          { type: 'palette/close' },
        ]).palette,
      ],
      expected: ['closed', 'create', 'closed'],
    });
  });
});

describe('reduceManager: the row being renamed', () => {
  test('one at a time', () => {
    assert({
      given: 'a row being renamed, then finished',
      should: 'hold that row, then none',
      actual: [
        runActions([{ type: 'drive/renaming', id: 'a' }]).renaming,
        runActions([
          { type: 'drive/renaming', id: 'a' },
          { type: 'drive/renaming', id: null },
        ]).renaming,
      ],
      expected: ['a', null],
    });
  });
});

describe('reduceManager: the panel a narrow screen shows', () => {
  const opening: ManagerAction = {
    type: 'doc/opening',
    id: 'a',
    title: 'Plan',
  };

  test('following the document', () => {
    assert({
      given: 'nothing open, then a document opening, then the back button',
      should: 'show Files, the document, then Files',
      actual: [
        initialManagerState().navigation.pane,
        runActions([opening]).navigation.pane,
        runActions([opening, { type: 'pane/files' }]).navigation.pane,
      ],
      expected: ['unselected', 'document', 'files'],
    });
  });

  test('a document reopened on arrival', () => {
    assert({
      given: 'a stored document loading with nothing open',
      should: 'show it, and leave someone already in Files where they are',
      actual: [
        runActions([{ type: 'doc/loaded', documents: [document] }]).navigation
          .pane,
        runActions([
          { type: 'doc/loaded', documents: [document] },
          { type: 'pane/files' },
          { type: 'doc/loaded', documents: [document] },
        ]).navigation.pane,
      ],
      expected: ['document', 'files'],
    });
  });

  test('the last tab closing', () => {
    assert({
      given: 'the only open tab closed',
      should: 'go back to Files rather than an empty panel',
      actual: runActions([opening, { type: 'tabs/close', id: 'a' }]).navigation
        .pane,
      expected: 'files',
    });
  });
});

test('choosing a cached document returns to its pane', () => {
  const cached = runActions([
    { type: 'doc/add', document },
    { type: 'pane/files' },
  ]);
  assert({
    given: 'Files after opening or closing a cached document',
    should: 'show its editor when chosen again',
    actual: [
      reduceManager(cached, { type: 'tabs/open', id: document.id }).navigation
        .pane,
      runActions(
        [
          { type: 'tabs/close', id: document.id },
          { type: 'tabs/open', id: document.id },
        ],
        cached,
      ).navigation.pane,
    ],
    expected: ['document', 'document'],
  });
});

test('a late body preserves Files navigation', () => {
  assert({
    given: 'a slow document read after returning to Files',
    should: 'keep Files visible when the body arrives',
    actual: runActions([
      { type: 'doc/opening', id: document.id, title: document.title },
      { type: 'pane/files' },
      { type: 'doc/add', document },
    ]).navigation.pane,
    expected: 'files',
  });
});

test('a late body preserves newer search', () => {
  assert({
    given: 'a document read outstanding when search opens',
    should: 'keep search open when its body arrives',
    actual: runActions([
      { type: 'doc/opening', id: document.id, title: document.title },
      { type: 'pane/files' },
      { type: 'palette/open', mode: 'search' },
      { type: 'doc/add', document },
    ]).palette,
    expected: 'search',
  });
});

test('the first body load never interrupts someone already using Files', () => {
  assert({
    given: 'a folder or menu used before the first bodies arrive',
    should: 'keep Files selected',
    actual: runActions([
      { type: 'files/used' },
      { type: 'doc/loaded', documents: [document] },
    ]).navigation.pane,
    expected: 'files',
  });
});
test('withdrawing the owner returns a narrow manager to Files', () => {
  assert({
    given: 'a document visible when its owner closes',
    should: 'show Files rather than an empty editor pane',
    actual: runActions([
      { type: 'doc/add', document },
      { type: 'doc/withdrawn' },
    ]).navigation.pane,
    expected: 'files',
  });
});
test('a folder deletion closes its documents in one transition and preserves others', () => {
  const other = { ...document, id: 'other' };
  const state = runActions([
    { type: 'doc/add', document },
    { type: 'doc/add', document: other },
    { type: 'tabs/activate', id: document.id },
  ]);
  const after = reduceManager(state, {
    type: 'drive/folder-deleted',
    id: 'folder',
    documentIds: [document.id],
  });
  assert({
    given: 'one open document in a deleted folder and another outside it',
    should: 'close only the deleted document and select its surviving neighbor',
    actual: [
      after.tabs,
      after.opened.map((one) =>
        one.kind === 'loaded' ? one.document.id : one.id,
      ),
    ],
    expected: [{ open: ['other'], active: 'other' }, ['other']],
  });
});

test('the pure navigation transition requests focus only for an explicit pane handoff', () => {
  const opening = {
    type: 'doc/opening',
    id: document.id,
    title: document.title,
  } as const;
  assert({
    given:
      'a passive first load, an explicit open, the last tab closed, and a passive owner withdrawal',
    should: 'leave passive focus alone and request the right explicit handoffs',
    actual: [
      runActions([{ type: 'doc/loaded', documents: [document] }]).navigation
        .focus,
      runActions([opening]).navigation.focus,
      runActions([opening, { type: 'tabs/close', id: document.id }]).navigation
        .focus,
      runActions([opening, { type: 'doc/withdrawn' }]).navigation.focus,
    ],
    expected: [null, 'document', 'files', null],
  });
});

test('a missing unloaded tab falls back to the loaded recent document in either arrival order', () => {
  const recent = {
    ...document,
    id: 'new-copy',
    html: '<p>Saved recovered text</p>',
  };
  const opening = {
    type: 'doc/opening',
    origin: 'link',
    id: 'gone',
    title: 'Old notes',
  } as const;
  const loaded = { type: 'doc/loaded', documents: [recent] } as const;
  const missing = { type: 'doc/missing', id: 'gone' } as const;
  const outcomes = [
    runActions([opening, loaded, missing]),
    runActions([opening, missing, loaded]),
  ];
  assert({
    given:
      'an old missing URL and the saved recovered copy arriving before or after its missing response',
    should: 'show the saved copy with no dead retry tab',
    actual: outcomes.map((state) => [state.tabs, state.navigation.pane]),
    expected: [
      [{ open: ['new-copy'], active: 'new-copy' }, 'document'],
      [{ open: ['new-copy'], active: 'new-copy' }, 'document'],
    ],
  });
  const typed = runActions([
    opening,
    { type: 'doc/loaded', documents: [{ ...document, id: 'gone' }] },
    {
      type: 'doc/update',
      id: 'gone',
      html: '<p>Typing before the older read answers</p>',
      now: document.updatedAt,
    },
    missing,
  ]);
  assert({
    given:
      'a body supplied by the initial load and typed into before an older null answer',
    should: 'retain the active tab and typed text',
    actual: [typed.tabs.active, loadedDocuments(typed.opened)[0]?.html],
    expected: ['gone', '<p>Typing before the older read answers</p>'],
  });
});

test('a missing row never reopens a document deliberately closed in this manager', () => {
  const stale = {
    type: 'doc/opening',
    id: 'gone',
    title: 'Stale row',
  } as const;
  const after = runActions([
    { type: 'doc/add', document },
    { type: 'tabs/close', id: document.id },
    stale,
    { type: 'doc/missing', id: stale.id },
  ]);
  assert({
    given: 'open A, close A, then open a stale row that has no body',
    should: 'close that missing tab to Files and leave A deliberately closed',
    actual: [
      after.tabs,
      after.navigation,
      loadedDocuments(after.opened).map((one) => one.id),
    ],
    expected: [
      { open: [], active: null },
      { pane: 'files', focus: 'files' },
      [document.id],
    ],
  });
});

test('Files use and explicit tab choices cancel an outstanding link fallback', () => {
  const linked: ManagerAction = {
    type: 'doc/opening',
    id: 'gone-link',
    title: 'Old link',
    origin: 'link',
  };
  const choices: readonly (readonly ManagerAction[])[] = [
    [{ type: 'files/used' }],
    [{ type: 'pane/files' }],
    [
      { type: 'tabs/open', id: document.id },
      { type: 'tabs/close', id: document.id },
    ],
    [{ type: 'tabs/close', id: 'gone-link' }],
  ];
  assert({
    given:
      'a link read pending while someone chooses Files, uses a row menu, or closes a tab',
    should: 'honor that later choice rather than reopening the cached body',
    actual: choices.map((choice) => {
      const state = runActions([
        linked,
        { type: 'doc/loaded', documents: [document] },
        ...choice,
        { type: 'doc/missing', id: 'gone-link' },
      ]);
      return [state.tabs.open, state.navigation.pane];
    }),
    expected: [
      [[], 'files'],
      [[], 'files'],
      [[], 'files'],
      [[], 'files'],
    ],
  });
});
