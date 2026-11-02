import type { FolderId, WorkspaceDocument } from './documents/documents';

type Folder = {
  readonly id: FolderId;
  readonly title: string;
  readonly shared: boolean;
};

/** The club drive's title is the club's name, filled in by buildTree. */
const folders: readonly Folder[] = [
  { id: 'library', title: 'My drive', shared: false },
  { id: 'club', title: '', shared: true },
];

export type TreeNode = {
  readonly folder: Folder;
  readonly documents: readonly WorkspaceDocument[];
};

const byCreated = (a: WorkspaceDocument, b: WorkspaceDocument) =>
  Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
  (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);

export function buildTree(
  documents: readonly WorkspaceDocument[],
  clubName: string | null,
): readonly TreeNode[] {
  return folders
    .filter((folder) => folder.id !== 'club' || clubName !== null)
    .map((folder) => ({
      folder:
        folder.id === 'club' ? { ...folder, title: clubName ?? '' } : folder,
      documents: documents
        .filter((d) => d.folder === folder.id)
        .sort(byCreated),
    }));
}

export type TabsState = {
  readonly open: readonly string[];
  readonly active: string | null;
};

export function openTab(tabs: TabsState, id: string): TabsState {
  return {
    open: tabs.open.includes(id) ? tabs.open : [...tabs.open, id],
    active: id,
  };
}

export function closeTab(tabs: TabsState, id: string): TabsState {
  const index = tabs.open.indexOf(id);
  if (index === -1) return tabs;
  const open = tabs.open.filter((tab) => tab !== id);
  if (tabs.active !== id) return { open, active: tabs.active };
  return { open, active: open[index] ?? open[index - 1] ?? null };
}

export function activateTab(tabs: TabsState, id: string): TabsState {
  return tabs.open.includes(id) ? { ...tabs, active: id } : tabs;
}

/** The right sidebar's tabs, the same in every Round. */
export type SidebarTab = 'transcript' | 'channels' | 'ai';
export const sidebarTabs: readonly SidebarTab[] = [
  'transcript',
  'channels',
  'ai',
];

/** A phone shows one panel at a time; the sidebar's tabs are among them. */
export type PhonePanel = 'doc' | SidebarTab | 'files' | 'room';
export const phonePanels: readonly PhonePanel[] = [
  'doc',
  ...sidebarTabs,
  'files',
  'room',
];

export type Channel = {
  readonly id: string;
  readonly title: string;
  readonly scope: 'round' | 'club';
};

export type Agent = {
  readonly id: string;
  readonly title: string;
  readonly scope: 'round' | 'club';
};

const lastEdited = (documents: readonly WorkspaceDocument[]) =>
  [...documents].sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  )[0]?.id;

/**
 * Reconcile stored documents without replacing a still-open valid tab. With
 * nothing open, the document edited last opens, so a reload lands on the work.
 */
export function loadWorkspaceDocuments<
  T extends {
    readonly tabs: TabsState;
    readonly documents: readonly WorkspaceDocument[];
  },
>(state: T, documents: readonly WorkspaceDocument[]): T {
  const ids = new Set(documents.map((d) => d.id));
  const open = state.tabs.open.filter(
    (id) => ids.has(id) || !state.documents.some((d) => d.id === id),
  );
  const latest = lastEdited(documents);
  const kept = open.length > 0 || !latest ? open : [latest];
  const active =
    state.tabs.active !== null && kept.includes(state.tabs.active)
      ? state.tabs.active
      : (kept[0] ?? null);
  return { ...state, documents, tabs: { open: kept, active } };
}

export function appendWorkspaceDocument<
  T extends {
    readonly documents: readonly WorkspaceDocument[];
    readonly tabs: TabsState;
    readonly paletteOpen: boolean;
  },
>(state: T, document: WorkspaceDocument): T {
  return {
    ...state,
    documents: [...state.documents, document],
    tabs: openTab(state.tabs, document.id),
    paletteOpen: false,
  };
}
