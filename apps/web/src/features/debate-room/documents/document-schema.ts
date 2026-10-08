import { OrderedList, TaskItem, TaskList } from '@tiptap/extension-list';
import StarterKit from '@tiptap/starter-kit';
import { DebateMarkExtension } from './debate-mark';

/**
 * The one document schema: the editor renders with it and the server
 * normalizes every save through it, so stored HTML only ever holds what
 * the editor can show (ADR 0054).
 */
const LIST_TYPES = new Set(['1', 'a', 'A', 'i', 'I']);

/** Ordered lists keep only the HTML list types, never free text. */
const KnownTypeOrderedList = OrderedList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      type: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const type = element.getAttribute('type');
          return type !== null && LIST_TYPES.has(type) ? type : null;
        },
      },
    };
  },
});

export const documentExtensions = [
  StarterKit.configure({
    link: false,
    code: false,
    codeBlock: false,
    orderedList: false,
  }),
  KnownTypeOrderedList,
  TaskList,
  TaskItem.configure({ nested: true }),
  DebateMarkExtension,
];
