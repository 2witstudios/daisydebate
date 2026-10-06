import { Mark, mergeAttributes } from '@tiptap/core';
import {
  debateMarks,
  type DebateMark,
} from '../../../features/debate-room/documents';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    debateMark: {
      /** Marks the selection (or clears it when already that kind). */
      toggleDebateMark: (kind: DebateMark) => ReturnType;
    };
  }
}

const isDebateMark = (value: unknown): value is DebateMark =>
  typeof value === 'string' &&
  (debateMarks as readonly string[]).includes(value);

/**
 * One mark with a kind (Aff, Neg, Extend, Dropped, New). It renders a
 * `data-debate-mark` attribute the stylesheet colours, never a style
 * attribute, so it stays inside the nonce CSP.
 */
export const DebateMarkExtension = Mark.create({
  name: 'debateMark',
  excludes: 'debateMark',

  addAttributes() {
    return {
      kind: {
        default: 'aff',
        parseHTML: (element) => {
          const kind = element.getAttribute('data-debate-mark');
          return isDebateMark(kind) ? kind : 'aff';
        },
        renderHTML: (attributes) => ({
          'data-debate-mark': isDebateMark(attributes.kind)
            ? attributes.kind
            : 'aff',
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-debate-mark]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      toggleDebateMark:
        (kind) =>
        ({ editor, commands }) =>
          editor.isActive(this.name, { kind })
            ? commands.unsetMark(this.name)
            : commands.setMark(this.name, { kind }),
    };
  },
});
