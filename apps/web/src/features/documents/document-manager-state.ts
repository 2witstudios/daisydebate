import {
  adoptServerText,
  renameDocument,
  updateDocumentHtml,
  type MemberDocument,
} from './document';
import {
  addEntry,
  emptyDrive,
  moveEntry,
  removeEntry,
  renameEntry,
  setExpanded,
  withPage,
  type DriveCursor,
  type DriveEntryView,
  type DriveTree,
} from './drive-tree';
import {
  activateTab,
  appendWorkspaceDocument,
  closeTab,
  loadWorkspaceDocuments,
  openTab,
  type TabsState,
} from './open-documents';

/** A viewer's choice of page for a document; null follows their theme. */
export type PageTone = 'light' | 'dark';

/**
 * What one document manager holds, wherever it opens (ADR 0111): the drive as
 * this browser has read it, the bodies of the documents it has opened, and the
 * tabs over them. A Round or Prep supplies a frame around it and owns none of it.
 */
export type ManagerState = {
  readonly drive: DriveTree;
  readonly documents: readonly MemberDocument[];
  readonly tabs: TabsState;
  readonly pages: Readonly<Record<string, PageTone | null>>;
  readonly paletteOpen: boolean;
};

export const initialManagerState = (
  drive: DriveTree = emptyDrive,
): ManagerState => ({
  drive,
  documents: [],
  tabs: { open: [], active: null },
  pages: {},
  paletteOpen: false,
});

export type ManagerAction =
  | { readonly type: 'tabs/open'; readonly id: string }
  | { readonly type: 'tabs/activate'; readonly id: string }
  | { readonly type: 'tabs/close'; readonly id: string }
  | {
      readonly type: 'doc/update';
      readonly id: string;
      readonly html: string;
      readonly now: string;
    }
  | {
      readonly type: 'doc/server-text';
      readonly id: string;
      readonly html: string;
      readonly now: string;
    }
  | {
      readonly type: 'doc/loaded';
      readonly documents: readonly MemberDocument[];
    }
  | { readonly type: 'doc/add'; readonly document: MemberDocument }
  | { readonly type: 'palette/open' }
  | { readonly type: 'palette/close' }
  | {
      readonly type: 'page/tone';
      readonly documentId: string;
      readonly tone: PageTone | null;
    }
  | {
      readonly type: 'drive/page';
      readonly folderId: string | null;
      readonly entries: readonly DriveEntryView[];
      readonly next: DriveCursor | null;
      readonly first: boolean;
    }
  | {
      readonly type: 'drive/expand';
      readonly folderId: string;
      readonly expanded: boolean;
    }
  | {
      readonly type: 'drive/add';
      readonly folderId: string | null;
      readonly entry: DriveEntryView;
    }
  | {
      readonly type: 'drive/rename';
      readonly id: string;
      readonly label: string;
      readonly now: string;
    }
  | {
      readonly type: 'drive/move';
      readonly id: string;
      readonly folderId: string | null;
    }
  | { readonly type: 'drive/remove'; readonly id: string };

const MANAGER_ACTIONS: ReadonlySet<string> = new Set<ManagerAction['type']>([
  'tabs/open',
  'tabs/activate',
  'tabs/close',
  'doc/update',
  'doc/server-text',
  'doc/loaded',
  'doc/add',
  'palette/open',
  'palette/close',
  'page/tone',
  'drive/page',
  'drive/expand',
  'drive/add',
  'drive/rename',
  'drive/move',
  'drive/remove',
]);

/** Whether an action is the manager's, for a frame that has actions of its own. */
export const isManagerAction = (action: {
  readonly type: string;
}): action is ManagerAction => MANAGER_ACTIONS.has(action.type);

/** Tabs that remain, with no body kept for one closed by a removal. */
const withoutDocument = <T extends ManagerState>(state: T, id: string): T => ({
  ...state,
  drive: removeEntry(state.drive, id),
  documents: state.documents.filter((doc) => doc.id !== id),
  tabs: closeTab(state.tabs, id),
});

/** The manager's one transition: total, with every other state unchanged. */
export function reduceManager<T extends ManagerState>(
  state: T,
  action: ManagerAction,
): T {
  const changeDocument = (
    id: string,
    change: (doc: MemberDocument) => MemberDocument,
  ) => ({
    ...state,
    documents: state.documents.map((doc) =>
      doc.id === id ? change(doc) : doc,
    ),
  });
  switch (action.type) {
    case 'tabs/open':
      return { ...state, tabs: openTab(state.tabs, action.id) };
    case 'tabs/close':
      return { ...state, tabs: closeTab(state.tabs, action.id) };
    case 'tabs/activate':
      return { ...state, tabs: activateTab(state.tabs, action.id) };
    case 'doc/loaded':
      return loadWorkspaceDocuments(state, action.documents);
    case 'doc/add':
      return state.documents.some((doc) => doc.id === action.document.id)
        ? {
            ...state,
            tabs: openTab(state.tabs, action.document.id),
            paletteOpen: false,
          }
        : appendWorkspaceDocument(state, action.document);
    case 'doc/server-text':
      return changeDocument(action.id, (doc) =>
        adoptServerText(doc, action.html, action.now),
      );
    case 'doc/update':
      return changeDocument(action.id, (doc) =>
        updateDocumentHtml(doc, action.html, action.now),
      );
    case 'palette/open':
      return { ...state, paletteOpen: true };
    case 'palette/close':
      return { ...state, paletteOpen: false };
    case 'page/tone':
      return {
        ...state,
        pages: { ...state.pages, [action.documentId]: action.tone },
      };
    case 'drive/page':
      return {
        ...state,
        drive: withPage(state.drive, action.folderId, action),
      };
    case 'drive/expand':
      return {
        ...state,
        drive: setExpanded(state.drive, action.folderId, action.expanded),
      };
    case 'drive/add':
      return {
        ...state,
        drive: addEntry(state.drive, action.folderId, action.entry),
      };
    case 'drive/rename':
      return {
        ...changeDocument(action.id, (doc) =>
          renameDocument(doc, action.label, action.now),
        ),
        drive: renameEntry(state.drive, action.id, action.label),
      };
    case 'drive/move':
      return {
        ...state,
        drive: moveEntry(state.drive, action.id, action.folderId),
      };
    case 'drive/remove':
      return withoutDocument(state, action.id);
  }
}
