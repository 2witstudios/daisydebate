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
  addOpenDocument,
  closeTab,
  findOpen,
  loadOpenDocuments,
  openId,
  openTab,
  type OpenDocument,
  type TabsState,
} from './open-documents';

/** A viewer's choice of page for a document; null follows their theme. */
export type PageTone = 'light' | 'dark';

/**
 * What one document manager holds, wherever it opens (ADR 0111): the drive as
 * this browser has read it, the documents it has opened, each loading, loaded or
 * failed, and the tabs over them. A Round or Prep supplies a frame around it and owns none of it.
 */
export type ManagerState = {
  readonly drive: DriveTree;
  readonly opened: readonly OpenDocument[];
  readonly tabs: TabsState;
  readonly pages: Readonly<Record<string, PageTone | null>>;
  readonly paletteOpen: boolean;
};

export const initialManagerState = (
  drive: DriveTree = emptyDrive,
): ManagerState => ({
  drive,
  opened: [],
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
  /** A person chose a document whose body has not arrived; its tab has no editor yet. */
  | {
      readonly type: 'doc/opening';
      readonly id: string;
      readonly title: string;
    }
  | { readonly type: 'doc/failed'; readonly id: string }
  /** The owner closed, so no document stays on screen. */
  | { readonly type: 'doc/withdrawn' }
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

/** A record, so a new action cannot be left out and silently dropped by a frame. */
const MANAGER_ACTIONS: Readonly<Record<ManagerAction['type'], true>> = {
  'tabs/open': true,
  'tabs/activate': true,
  'tabs/close': true,
  'doc/update': true,
  'doc/server-text': true,
  'doc/loaded': true,
  'doc/add': true,
  'doc/opening': true,
  'doc/failed': true,
  'doc/withdrawn': true,
  'palette/open': true,
  'palette/close': true,
  'page/tone': true,
  'drive/page': true,
  'drive/expand': true,
  'drive/add': true,
  'drive/rename': true,
  'drive/move': true,
  'drive/remove': true,
};

/** Whether an action is the manager's, for a frame that has actions of its own. */
export const isManagerAction = (action: {
  readonly type: string;
}): action is ManagerAction => Object.hasOwn(MANAGER_ACTIONS, action.type);

/** Tabs that remain, with no body kept for one closed by a removal. */
const withoutDocument = <T extends ManagerState>(state: T, id: string): T => ({
  ...state,
  drive: removeEntry(state.drive, id),
  opened: state.opened.filter((open) => openId(open) !== id),
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
    opened: state.opened.map((open): OpenDocument =>
      open.kind === 'loaded' && open.document.id === id
        ? { kind: 'loaded', document: change(open.document) }
        : open,
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
      return loadOpenDocuments(state, action.documents);
    case 'doc/withdrawn':
      return { ...state, opened: [], tabs: { open: [], active: null } };
    case 'doc/add':
      return addOpenDocument(state, action.document);
    case 'doc/opening': {
      const known = findOpen(state.opened, action.id);
      const opened: readonly OpenDocument[] =
        known?.kind === 'failed'
          ? state.opened.map((open) =>
              openId(open) === action.id
                ? { kind: 'loading', id: action.id, title: action.title }
                : open,
            )
          : known
            ? state.opened
            : [
                ...state.opened,
                { kind: 'loading', id: action.id, title: action.title },
              ];
      return {
        ...state,
        opened,
        tabs: openTab(state.tabs, action.id),
        paletteOpen: false,
      };
    }
    case 'doc/failed':
      return {
        ...state,
        opened: state.opened.map((open) =>
          open.kind === 'loading' && open.id === action.id
            ? { kind: 'failed', id: open.id, title: open.title }
            : open,
        ),
      };
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
