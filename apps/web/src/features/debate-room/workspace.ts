import type { CompetitionType } from '@daisy/protocol';
import type { FolderId, WorkspaceDocument } from './documents/documents';

type Folder = {
  readonly id: FolderId;
  readonly title: string;
  readonly shared: boolean;
};

/** The club folder's title is the club's name, filled in by buildTree. */
const folders: readonly Folder[] = [
  { id: 'round', title: 'This round', shared: false },
  { id: 'library', title: 'My library', shared: false },
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

export type DrawerTab = 'files' | 'chat' | 'ai' | 'room';

/** A ranked round has no AI: outside help would make the result unfair. */
export function drawerTabs(competition: CompetitionType): readonly DrawerTab[] {
  return competition === 'ranked'
    ? ['files', 'chat', 'room']
    : ['files', 'chat', 'ai', 'room'];
}

export type Channel = {
  readonly id: string;
  readonly title: string;
  readonly scope: 'round' | 'club';
};

export function visibleChannels(
  channels: readonly Channel[],
  competition: CompetitionType,
): readonly Channel[] {
  return competition === 'ranked'
    ? channels.filter((c) => c.scope === 'round')
    : channels;
}

/** A ranked round shows no club folder: the club's files are outside help (DEC-175). */
export const visibleClub = (
  clubName: string | null,
  competition: CompetitionType,
): string | null => (competition === 'ranked' ? null : clubName);

export type Agent = {
  readonly id: string;
  readonly title: string;
  readonly scope: 'round' | 'club';
};

export function visibleAgents(
  agents: readonly Agent[],
  competition: CompetitionType,
): readonly Agent[] {
  return competition === 'ranked' ? [] : agents;
}

/** Reconcile stored documents without replacing a still-open valid tab. */
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
  const round = documents.filter((d) => d.folder === 'round').map((d) => d.id);
  const kept = open.length > 0 ? open : round;
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
