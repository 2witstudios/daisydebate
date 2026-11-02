import type { Node } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';

/**
 * Text arriving from outside the editor (an applied agent edit, a server load).
 * Only the changed range is replaced, so the caret maps through it. It is not an
 * undo step, because Undo would then save the replaced text over the new one, and
 * it does not echo back as a local edit. Null when nothing differs.
 */
export function outsideTextTransaction(
  state: EditorState,
  next: Node,
): Transaction | null {
  const { content } = state.doc;
  const start = content.findDiffStart(next.content);
  const end = content.findDiffEnd(next.content);
  if (start === null || !end) return null;
  // Repeated text can make the two ends cross; both must stay after the start.
  const overlap = Math.max(0, start - Math.min(end.a, end.b));
  return state.tr
    .replace(start, end.a + overlap, next.slice(start, end.b + overlap))
    .setMeta('addToHistory', false)
    .setMeta('preventUpdate', true);
}
