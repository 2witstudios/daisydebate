import type { MemberDocument } from './document';

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

/**
 * A document with a tab (ADR 0111). A body exists only once it has loaded, so
 * there is no editor, and nothing to type into, before then. Loaded is the only
 * state with a revision to save against, and a later read never replaces it.
 */
export type OpenDocument =
  | { readonly kind: 'loading'; readonly id: string; readonly title: string }
  | { readonly kind: 'loaded'; readonly document: MemberDocument }
  | { readonly kind: 'failed'; readonly id: string; readonly title: string };

export const openId = (open: OpenDocument): string =>
  open.kind === 'loaded' ? open.document.id : open.id;
export const openTitle = (open: OpenDocument): string =>
  open.kind === 'loaded' ? open.document.title : open.title;
export const loadedDocuments = (
  opened: readonly OpenDocument[],
): readonly MemberDocument[] =>
  opened.flatMap((open) => (open.kind === 'loaded' ? [open.document] : []));
export const findOpen = (
  opened: readonly OpenDocument[],
  id: string,
): OpenDocument | undefined => opened.find((open) => openId(open) === id);

const lastEdited = (documents: readonly MemberDocument[]) =>
  [...documents].sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  )[0]?.id;

/** Bodies arriving: what is still loading takes them, and a loaded document keeps its own. */
const withBodies = (
  opened: readonly OpenDocument[],
  documents: readonly MemberDocument[],
): readonly OpenDocument[] => {
  const arrived = new Map(documents.map((doc) => [doc.id, doc]));
  const kept = opened.map((open): OpenDocument => {
    const body = arrived.get(openId(open));
    return open.kind !== 'loaded' && body
      ? { kind: 'loaded', document: body }
      : open;
  });
  const held = new Set(kept.map(openId));
  return [
    ...kept,
    ...documents
      .filter((doc) => !held.has(doc.id))
      .map((document): OpenDocument => ({ kind: 'loaded', document })),
  ];
};

/** With nothing open, the document edited last opens, so a reload lands on the work. */
export function loadOpenDocuments<
  T extends {
    readonly tabs: TabsState;
    readonly opened: readonly OpenDocument[];
  },
>(state: T, documents: readonly MemberDocument[]): T {
  const latest = lastEdited(documents);
  const open =
    state.tabs.open.length > 0 || !latest ? state.tabs.open : [latest];
  const active =
    state.tabs.active !== null && open.includes(state.tabs.active)
      ? state.tabs.active
      : (open[0] ?? null);
  return {
    ...state,
    opened: withBodies(state.opened, documents),
    tabs: { open, active },
  };
}

/** A document whose body has arrived, opened in a tab. */
export function addOpenDocument<
  T extends {
    readonly opened: readonly OpenDocument[];
    readonly tabs: TabsState;
    readonly paletteOpen: boolean;
  },
>(state: T, document: MemberDocument): T {
  // A body answering a tab already there leaves the person where they are now:
  // they may have moved on and be typing, or closed it while it loaded.
  const awaited = state.opened.some(
    (open) => open.kind === 'loading' && open.id === document.id,
  );
  return {
    ...state,
    opened: withBodies(state.opened, [document]),
    tabs: awaited ? state.tabs : openTab(state.tabs, document.id),
    paletteOpen: false,
  };
}
