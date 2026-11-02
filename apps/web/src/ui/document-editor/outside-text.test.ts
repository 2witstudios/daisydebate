import { getSchema } from '@tiptap/core';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { documentExtensions } from '../../features/documents/document-schema';
import { outsideTextTransaction } from './outside-text';

setupRitewayBun();

const undoable = { undoable: true };
const schema = getSchema(documentExtensions);
const doc = (...paragraphs: readonly string[]) =>
  schema.nodeFromJSON({
    type: 'doc',
    content: paragraphs.map((text) => ({
      type: 'paragraph',
      content: [{ type: 'text', text }],
    })),
  });
const at = (paragraphs: readonly string[], position: number) => {
  const start = doc(...paragraphs);
  return EditorState.create({
    doc: start,
    selection: TextSelection.create(start, position),
  });
};
const textBeforeCaret = (state: EditorState) => {
  const { $head } = state.selection;
  return $head.parent.textBetween(0, $head.parentOffset);
};

test('the caret stays in the same words when text arrives above it', () => {
  const state = at(['Alpha beta'], 6);
  const moved = state.apply(
    outsideTextTransaction(state, doc('Opening line', 'Alpha beta'), undoable)!,
  );
  assert({
    given: 'a caret after "Alpha" and a new paragraph arriving above',
    should: 'keep the caret after "Alpha", not inside the new paragraph',
    actual: [moved.doc.textContent, textBeforeCaret(moved)],
    expected: ['Opening lineAlpha beta', 'Alpha'],
  });
});

test('a caret in removed text lands in text', () => {
  const state = at(['short', 'next'], 9);
  const moved = state.apply(
    outsideTextTransaction(state, doc('short'), undoable)!,
  );
  assert({
    given: 'a caret in a paragraph the new text removes',
    should: 'land inside the remaining text, never between blocks',
    actual: [moved.doc.textContent, moved.selection.$head.parent.isTextblock],
    expected: ['short', true],
  });
});

test('repeated text keeps the replaced range valid', () => {
  const state = at(['aaa'], 1);
  const moved = state.apply(
    outsideTextTransaction(state, doc('aaaa'), undoable)!,
  );
  assert({
    given: 'new text whose common start and end overlap',
    should: 'still produce exactly the new text',
    actual: moved.doc.textContent,
    expected: 'aaaa',
  });
});

test('only server text leaves the undo history', () => {
  const state = at(['old'], 1);
  const applied = outsideTextTransaction(state, doc('new'), undoable)!;
  const server = outsideTextTransaction(state, doc('new'), {
    undoable: false,
  })!;
  assert({
    given: 'an applied edit and adopted server text',
    should:
      'keep the applied edit undoable, keep server text out of history, and never echo',
    actual: [
      applied.getMeta('addToHistory'),
      server.getMeta('addToHistory'),
      applied.getMeta('preventUpdate'),
      server.getMeta('preventUpdate'),
    ],
    expected: [undefined, false, true, true],
  });
});

test('identical text changes nothing', () => {
  assert({
    given: 'new text equal to the editor text',
    should: 'produce no transaction',
    actual: outsideTextTransaction(at(['same'], 2), doc('same'), undoable),
    expected: null,
  });
});
