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
        initialManagerState().pane,
        runActions([opening]).pane,
        runActions([opening, { type: 'pane/files' }]).pane,
      ],
      expected: ['files', 'document', 'files'],
    });
  });

  test('the last tab closing', () => {
    assert({
      given: 'the only open tab closed',
      should: 'go back to Files rather than an empty panel',
      actual: runActions([opening, { type: 'tabs/close', id: 'a' }]).pane,
      expected: 'files',
    });
  });
});
