import type { PaletteMode } from './command-palette';
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
  loadedDocuments,
  openId,
  openTab,
  type OpenDocument,
  type TabsState,
} from './open-documents';

/** A pane choice and its optional focus effect, decided by one pure transition. */
export type ManagerNavigation =
  | { readonly pane: 'unselected' | 'files'; readonly focus: 'files' | null }
  | {
      readonly pane: 'document';
      readonly focus: 'document' | null;
      readonly onMissing: 'recent' | 'files';
    };

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
  readonly palette: PaletteMode;
  /** The row whose name is being typed. */
  readonly renaming: string | null;
  /** The one panel a narrow screen shows. */
  readonly navigation: ManagerNavigation;
};

export const initialManagerState = (
  drive: DriveTree = emptyDrive,
): ManagerState => ({
  drive,
  opened: [],
  tabs: { open: [], active: null },
  pages: {},
  palette: 'closed',
  renaming: null,
  navigation: { pane: 'unselected', focus: null },
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
      /** Only the initial URL opening may fall back to the last edited body. */
      readonly origin?: 'link';
    }
  | { readonly type: 'doc/failed'; readonly id: string }
  /** A confirmed missing response can close only a tab that still has no body. */
  | { readonly type: 'doc/missing'; readonly id: string }
  /** Off this page's tabs and memory, still in the drive; opening it reads afresh. */
  | { readonly type: 'doc/closed'; readonly id: string }
  /** The owner closed, so no document stays on screen. */
  | { readonly type: 'doc/withdrawn' }
  | {
      readonly type: 'palette/open';
      readonly mode: Exclude<PaletteMode, 'closed'>;
    }
  | { readonly type: 'pane/files' }
  | { readonly type: 'files/used' }
  | {
      readonly type: 'drive/folder-deleted';
      readonly id: string;
      readonly documentIds: readonly string[];
    }
  | { readonly type: 'drive/renaming'; readonly id: string | null }
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
  | { readonly type: 'drive/remove'; readonly id: string }
  /** Gone from the tree, while an offer of its text still needs its entry. */
  | { readonly type: 'drive/unlist'; readonly id: string };

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
  'doc/missing': true,
  'doc/closed': true,
  'doc/withdrawn': true,
  'palette/open': true,
  'pane/files': true,
  'files/used': true,
  'drive/folder-deleted': true,
  'drive/renaming': true,
  'palette/close': true,
  'page/tone': true,
  'drive/page': true,
  'drive/expand': true,
  'drive/add': true,
  'drive/rename': true,
  'drive/move': true,
  'drive/remove': true,
  'drive/unlist': true,
};

/** Whether an action is the manager's, for a frame that has actions of its own. */
export const isManagerAction = (action: {
  readonly type: string;
}): action is ManagerAction => Object.hasOwn(MANAGER_ACTIONS, action.type);

const withNavigation = <T extends ManagerState>(
  state: T,
  pane: ManagerNavigation['pane'],
  requested: boolean,
  onMissing: 'recent' | 'files' = 'files',
): T => {
  if (pane === state.navigation.pane) {
    if (
      state.navigation.pane === 'document' &&
      state.navigation.onMissing !== onMissing
    )
      return {
        ...state,
        navigation: { ...state.navigation, focus: null, onMissing },
      };
    return state;
  }
  const wasDocument = state.navigation.pane === 'document';
  const navigation: ManagerNavigation =
    pane === 'document'
      ? {
          pane,
          focus: requested && !wasDocument ? 'document' : null,
          onMissing,
        }
      : { pane, focus: requested && wasDocument ? 'files' : null };
  return { ...state, navigation };
};

/** The tabs that remain; a deliberate last close hands focus back to Files. */
const withTabs = <T extends ManagerState>(
  state: T,
  tabs: TabsState,
  requested = true,
): T => {
  const next = { ...state, tabs };
  return tabs.open.length === 0
    ? withNavigation(next, 'files', requested)
    : requested && next.navigation.pane === 'document'
      ? withNavigation(next, 'document', true)
      : next;
};

/** Tabs that remain, with no body kept for one closed by a removal. */
const withoutDocument = <T extends ManagerState>(state: T, id: string): T => ({
  ...withTabs(state, closeTab(state.tabs, id)),
  drive: removeEntry(state.drive, id),
  opened: state.opened.filter((open) => openId(open) !== id),
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
      return withNavigation(
        { ...state, tabs: openTab(state.tabs, action.id) },
        'document',
        true,
      );
    case 'tabs/close':
      return withTabs(state, closeTab(state.tabs, action.id));
    case 'tabs/activate':
      return withNavigation(
        { ...state, tabs: activateTab(state.tabs, action.id) },
        'document',
        true,
      );
    case 'doc/loaded': {
      const loaded = loadOpenDocuments(state, action.documents);
      // A default pane follows arrival; any use of Files commits that choice.
      return state.navigation.pane === 'unselected' &&
        loaded.tabs.open.length > 0
        ? withNavigation(loaded, 'document', false)
        : loaded;
    }
    case 'doc/withdrawn':
      return {
        ...withTabs(state, { open: [], active: null }, false),
        opened: [],
      };
    case 'doc/add': {
      const added = addOpenDocument(state, action.document);
      return findOpen(state.opened, action.document.id)
        ? added
        : withNavigation(added, 'document', true);
    }
    case 'doc/missing': {
      if (findOpen(state.opened, action.id)?.kind === 'loaded') return state;
      const closed = {
        ...state,
        tabs: closeTab(state.tabs, action.id),
        opened: state.opened.filter((open) => openId(open) !== action.id),
      };
      if (
        state.navigation.pane !== 'document' ||
        state.navigation.onMissing !== 'recent'
      )
        return withTabs(closed, closed.tabs);
      // Only an initial link may fall back. A row chosen after closing a cached
      // document must not reopen the body the person deliberately left behind.
      // Either initial-load arrival order still lands on a saved recent copy.
      const fallback = loadOpenDocuments(
        closed,
        loadedDocuments(closed.opened),
      );
      return state.navigation.pane === 'document'
        ? withNavigation(
            fallback,
            fallback.tabs.open.length > 0 ? 'document' : 'unselected',
            true,
          )
        : fallback;
    }
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
      return withNavigation(
        {
          ...state,
          opened,
          tabs: openTab(state.tabs, action.id),
          palette: 'closed',
        },
        'document',
        true,
        action.origin === 'link' ? 'recent' : 'files',
      );
    }
    case 'doc/closed':
      return {
        ...withTabs(state, closeTab(state.tabs, action.id)),
        opened: state.opened.filter((open) => openId(open) !== action.id),
      };
    case 'drive/unlist':
      return { ...state, drive: removeEntry(state.drive, action.id) };
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
      return { ...state, palette: action.mode };
    case 'palette/close':
      return { ...state, palette: 'closed' };
    case 'files/used':
      return state.navigation.pane === 'unselected'
        ? withNavigation(state, 'files', false)
        : state.navigation.pane === 'document'
          ? withNavigation(state, 'document', false)
          : state;
    case 'pane/files':
      return withNavigation(state, 'files', true);
    case 'drive/renaming':
      return { ...state, renaming: action.id };
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
    case 'drive/folder-deleted': {
      const removed = new Set(action.documentIds);
      const active = state.tabs.active;
      const at = active === null ? -1 : state.tabs.open.indexOf(active);
      const tabs = {
        open: state.tabs.open.filter((id) => !removed.has(id)),
        active:
          active === null || !removed.has(active)
            ? active
            : (state.tabs.open.slice(at + 1).find((id) => !removed.has(id)) ??
              state.tabs.open
                .slice(0, at)
                .reverse()
                .find((id) => !removed.has(id)) ??
              null),
      };
      return {
        ...withTabs(state, tabs),
        drive: removeEntry(state.drive, action.id),
        opened: state.opened.filter((open) => !removed.has(openId(open))),
      };
    }
    case 'drive/remove':
      return withoutDocument(state, action.id);
  }
}
