import { Node } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { type EditorState, Plugin, type Transaction } from '@tiptap/pm/state';

/** The column counts a landscape page offers. */
export const pageColumnChoices = [2, 3, 4, 5, 6] as const;
export type PageColumns = (typeof pageColumnChoices)[number];

/** Portrait by default; landscape lays the document out in columns. */
export type PageLayout =
  | { readonly orientation: 'portrait' }
  | { readonly orientation: 'landscape'; readonly columns: PageColumns };

export const portrait: PageLayout = { orientation: 'portrait' };

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageLayout: {
      /** Sets the document's page: portrait, or landscape in columns. */
      setPageLayout: (layout: PageLayout) => ReturnType;
    };
  }
}

const NAME = 'pageLayout';
/** Marks a transaction from the page control, which may remove the setting. */
const FROM_CONTROL = 'pageLayoutControl';

/** A stored column count, only when the page offers it. */
export const parsePageColumns = (value: string | null): PageColumns | null =>
  pageColumnChoices.find((count) => String(count) === value) ?? null;

const settingOf = (doc: ProseMirrorNode): ProseMirrorNode | null =>
  doc.firstChild?.type.name === NAME ? doc.firstChild : null;

/** The page a document is laid out on, read from its opening setting. */
export function pageLayoutOf(doc: ProseMirrorNode): PageLayout {
  const columns = parsePageColumns(String(settingOf(doc)?.attrs.columns));
  return columns === null ? portrait : { orientation: 'landscape', columns };
}

/** The transaction that gives a document its page layout. */
export function pageLayoutTransaction(
  state: EditorState,
  layout: PageLayout,
): Transaction {
  const tr = state.tr.setMeta(FROM_CONTROL, true);
  const setting = settingOf(state.doc);
  if (layout.orientation === 'portrait')
    return setting ? tr.delete(0, setting.nodeSize) : tr;
  const attrs = { columns: layout.columns };
  return setting
    ? tr.setNodeMarkup(0, undefined, attrs)
    : tr.insert(0, state.schema.nodes[NAME]!.create(attrs));
}

/**
 * Puts the page setting back when an edit (a select-all delete, a backspace
 * at the start) removes it; only the page control and loads from storage
 * change it.
 */
export function keepPageLayout(
  transactions: readonly Transaction[],
  before: EditorState,
  after: EditorState,
): Transaction | null {
  const setting = settingOf(before.doc);
  if (!setting || settingOf(after.doc)) return null;
  const deliberate = transactions.some(
    (tr) => tr.getMeta(FROM_CONTROL) || tr.getMeta('preventUpdate'),
  );
  return deliberate
    ? null
    : after.tr.insert(0, setting.type.create(setting.attrs));
}

/**
 * The page setting: an empty leaf the document may open with, stored as
 * `<div data-page="landscape" data-columns="N">`. Data attributes only, so
 * the stylesheet lays the columns out without a style attribute.
 */
export const PageLayoutNode = Node.create({
  name: NAME,
  atom: true,
  selectable: false,
  draggable: false,

  addAttributes() {
    return {
      columns: {
        default: pageColumnChoices[0],
        parseHTML: (element) =>
          parsePageColumns(element.getAttribute('data-columns')),
        renderHTML: (attributes) => ({
          'data-columns': String(attributes.columns),
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-page="landscape"]',
        priority: 60,
        getAttrs: (element) =>
          parsePageColumns(element.getAttribute('data-columns')) === null
            ? false
            : null,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { 'data-page': 'landscape', ...HTMLAttributes }];
  },

  addCommands() {
    return {
      setPageLayout:
        (layout) =>
        ({ state, dispatch }) => {
          if (dispatch) dispatch(pageLayoutTransaction(state, layout));
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: (transactions, before, after) =>
          keepPageLayout(transactions, before, after),
      }),
    ];
  },
});

/** The document: an optional page setting, then its blocks. */
export const PagedDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: `${NAME}? block+`,
});
