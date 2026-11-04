import type { MemberDocument } from './document';

const byCreated = (a: MemberDocument, b: MemberDocument) =>
  Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
  (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);

/** The viewer's own drive, oldest first. Club drives arrive with prep-documents. */
export const driveDocuments = (
  documents: readonly MemberDocument[],
): readonly MemberDocument[] => [...documents].sort(byCreated);

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

const lastEdited = (documents: readonly MemberDocument[]) =>
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
    readonly documents: readonly MemberDocument[];
  },
>(state: T, documents: readonly MemberDocument[]): T {
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
    readonly documents: readonly MemberDocument[];
    readonly tabs: TabsState;
    readonly paletteOpen: boolean;
  },
>(state: T, document: MemberDocument): T {
  return {
    ...state,
    documents: [...state.documents, document],
    tabs: openTab(state.tabs, document.id),
    paletteOpen: false,
  };
}
