import { getSchema } from '@tiptap/core';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { documentExtensions } from '../../features/documents/document-schema';
import { outsideTextTransaction } from './outside-text';

setupRitewayBun();

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
    outsideTextTransaction(state, doc('Opening line', 'Alpha beta'))!,
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
  const moved = state.apply(outsideTextTransaction(state, doc('short'))!);
  assert({
    given: 'a caret in a paragraph the new text removes',
    should: 'land inside the remaining text, never between blocks',
    actual: [moved.doc.textContent, moved.selection.$head.parent.isTextblock],
    expected: ['short', true],
  });
});

test('repeated text keeps the replaced range valid', () => {
  const state = at(['aaa'], 1);
  const moved = state.apply(outsideTextTransaction(state, doc('aaaa'))!);
  assert({
    given: 'new text whose common start and end overlap',
    should: 'still produce exactly the new text',
    actual: moved.doc.textContent,
    expected: 'aaaa',
  });
});

test('outside text is neither an undo step nor a local edit', () => {
  const state = at(['old'], 1);
  const tr = outsideTextTransaction(state, doc('new'))!;
  assert({
    given: 'text replaced from outside the editor',
    should: 'stay out of the undo history and not echo back',
    actual: [tr.getMeta('addToHistory'), tr.getMeta('preventUpdate')],
    expected: [false, true],
  });
});

test('identical text changes nothing', () => {
  assert({
    given: 'new text equal to the editor text',
    should: 'produce no transaction',
    actual: outsideTextTransaction(at(['same'], 2), doc('same')),
    expected: null,
  });
});
