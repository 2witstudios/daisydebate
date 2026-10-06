import { TaskItem, TaskList } from '@tiptap/extension-list';
import StarterKit from '@tiptap/starter-kit';
import { DebateMarkExtension } from './debate-mark';

/**
 * The one document schema: the editor renders with it and the server
 * normalizes every save through it, so stored HTML only ever holds what
 * the editor can show (ADR 0054).
 */
export const documentExtensions = [
  StarterKit.configure({ link: false, code: false, codeBlock: false }),
  TaskList,
  TaskItem.configure({ nested: true }),
  DebateMarkExtension,
];
