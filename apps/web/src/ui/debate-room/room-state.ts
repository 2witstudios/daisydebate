import { markRead, type ChatMessage } from '../../features/debate-room/chat';
import { applyProposal } from '../../features/debate-room/documents/document-edits';
import {
  createDocument,
  updateDocumentHtml,
  type FolderId,
  type TemplateId,
  type WorkspaceDocument,
} from '../../features/debate-room/documents/documents';
import {
  initialLayout,
  nudgeVideo,
  resizeVideo,
  selectMode,
  type LayoutMode,
  type LayoutState,
} from '../../features/debate-room/layout';
import { TRANSCRIPT_ID } from '../../features/debate-room/transcript';
import {
  activateTab,
  loadWorkspaceDocuments,
  appendWorkspaceDocument,
  closeTab,
  drawerTabs,
  openTab,
  roundKindOf,
  type DrawerTab,
  type TabsState,
} from '../../features/debate-room/workspace';
import type { RoundSnapshot } from './round';

export type PageTone = 'dark' | 'light';
export type EditOutcome = 'applied' | 'discarded';

export type RoomState = {
  readonly layout: LayoutState;
  readonly tabs: TabsState;
  readonly documents: readonly WorkspaceDocument[];
  readonly drawer: DrawerTab;
  /** Beside the document on a wide screen; open by default. */
  readonly drawerOpen: boolean;
  /** In place of the document on a phone; closed by default. */
  readonly phoneDrawer: boolean;
  readonly channelId: string;
  readonly agentId: string;
  readonly messages: readonly ChatMessage[];
  readonly readMarkers: Readonly<Record<string, string>>;
  readonly edits: Readonly<Record<string, EditOutcome>>;
  readonly transcriptFilter: string;
  readonly paletteOpen: boolean;
  /** Each document's page tone; a document not listed is dark. */
  readonly pages: Readonly<Record<string, PageTone>>;
};

export type RoomAction =
  | {
      readonly type: 'layout/mode';
      readonly mode: LayoutMode;
    }
  | {
      readonly type: 'layout/resize';
      readonly startPx: number;
      readonly deltaPx: number;
    }
  | { readonly type: 'layout/nudge'; readonly key: string }
  | { readonly type: 'tabs/open'; readonly id: string }
  | { readonly type: 'tabs/activate'; readonly id: string }
  | { readonly type: 'tabs/close'; readonly id: string }
  | {
      readonly type: 'doc/create';
      readonly id: string;
      readonly now: string;
      readonly templateId: TemplateId;
      readonly folder: FolderId;
    }
  | {
      readonly type: 'doc/update';
      readonly id: string;
      readonly html: string;
      readonly now: string;
    }
  | {
      readonly type: 'doc/loaded';
      readonly documents: readonly WorkspaceDocument[];
    }
  | { readonly type: 'doc/add'; readonly document: WorkspaceDocument }
  | { readonly type: 'drawer/tab'; readonly tab: DrawerTab }
  | { readonly type: 'drawer/toggle' }
  /** A phone's round tabs: a drawer tab, or null for the document. */
  | { readonly type: 'drawer/phone'; readonly tab: DrawerTab | null }
  | {
      readonly type: 'drawer/channel';
      readonly channelId: string;
      readonly now: string;
    }
  | { readonly type: 'drawer/agent'; readonly agentId: string }
  | {
      readonly type: 'agent/edit';
      readonly turnId: string;
      readonly outcome: EditOutcome;
      readonly documentId: string;
      readonly removed: readonly string[];
      readonly added: readonly string[];
      readonly now: string;
    }
  | { readonly type: 'transcript/filter'; readonly speechId: string }
  | { readonly type: 'palette/open' }
  | { readonly type: 'palette/close' }
  | {
      readonly type: 'page/tone';
      readonly documentId: string;
      readonly tone: PageTone;
    };

const firstRoundDocument = (round: RoundSnapshot) =>
  round.documents.find((doc) => doc.folder === 'round')?.id ?? null;

/** While the ballots are written, the transcript opens first. */
function initialTabs(round: RoundSnapshot): TabsState {
  const roundDocs = round.documents
    .filter((doc) => doc.folder === 'round')
    .map((doc) => doc.id);
  if (round.phase === 'judging' && round.transcribing)
    return { open: [TRANSCRIPT_ID, ...roundDocs], active: TRANSCRIPT_ID };
  return { open: roundDocs, active: firstRoundDocument(round) };
}

export function initialRoomState(round: RoundSnapshot): RoomState {
  return {
    layout: initialLayout,
    tabs: initialTabs(round),
    documents: round.documents,
    drawer: 'files',
    drawerOpen: true,
    phoneDrawer: false,
    channelId: 'round',
    agentId: round.agents[0]?.id ?? '',
    messages: round.messages,
    readMarkers: {},
    edits: {},
    transcriptFilter: 'all',
    paletteOpen: false,
    pages: {},
  };
}

/** The page tone a document is shown on. */
export const pageToneOf = (state: RoomState, documentId: string): PageTone =>
  state.pages[documentId] ?? 'dark';

const withDocument = (
  state: RoomState,
  id: string,
  change: (doc: WorkspaceDocument) => WorkspaceDocument,
): RoomState => ({
  ...state,
  documents: state.documents.map((doc) => (doc.id === id ? change(doc) : doc)),
});

type Reducer<T extends RoomAction['type']> = (
  state: RoomState,
  action: Extract<RoomAction, { type: T }>,
  round: RoundSnapshot,
) => RoomState;

const reducers: { readonly [T in RoomAction['type']]: Reducer<T> } = {
  'layout/mode': (s, a) => ({ ...s, layout: selectMode(a.mode) }),
  'layout/resize': (s, a, r) => ({
    ...s,
    layout: resizeVideo(s.layout, r.phase, a.startPx, a.deltaPx),
  }),
  'layout/nudge': (s, a, r) => ({
    ...s,
    layout: nudgeVideo(s.layout, r.phase, a.key),
  }),
  'tabs/open': (s, a) => ({ ...s, tabs: openTab(s.tabs, a.id) }),
  'tabs/activate': (s, a) => ({ ...s, tabs: activateTab(s.tabs, a.id) }),
  'tabs/close': (s, a) => ({ ...s, tabs: closeTab(s.tabs, a.id) }),
  'doc/create': (s, a, r) => {
    const doc = createDocument({
      id: a.id,
      now: a.now,
      folder: a.folder,
      templateId: a.templateId,
      existingTitles: s.documents.map((d) => d.title),
      context: {
        side: r.self.side,
        speeches: r.speeches,
        title: '',
        currentIndex: r.liveIndex - 1,
      },
    });
    return {
      ...s,
      documents: [...s.documents, doc],
      tabs: openTab(s.tabs, doc.id),
      paletteOpen: false,
    };
  },
  'doc/update': (s, a) =>
    withDocument(s, a.id, (doc) => updateDocumentHtml(doc, a.html, a.now)),
  'doc/loaded': (s, a) => loadWorkspaceDocuments(s, a.documents),
  'doc/add': (s, a) => appendWorkspaceDocument(s, a.document),
  'drawer/tab': (s, a, r) =>
    drawerTabs(roundKindOf(r.competition)).includes(a.tab)
      ? { ...s, drawer: a.tab, drawerOpen: true }
      : s,
  'drawer/toggle': (s) => ({ ...s, drawerOpen: !s.drawerOpen }),
  'drawer/phone': (s, a, r) => {
    if (a.tab === null) return { ...s, phoneDrawer: false };
    return drawerTabs(roundKindOf(r.competition)).includes(a.tab)
      ? { ...s, drawer: a.tab, phoneDrawer: true }
      : s;
  },
  'drawer/channel': (s, a) => ({
    ...s,
    channelId: a.channelId,
    readMarkers: markRead(s.readMarkers, a.channelId, a.now),
  }),
  'drawer/agent': (s, a) => ({ ...s, agentId: a.agentId }),
  'agent/edit': (s, a) => {
    if (s.edits[a.turnId]) return s;
    const marked = { ...s, edits: { ...s.edits, [a.turnId]: a.outcome } };
    if (a.outcome === 'discarded') return marked;
    const applied = withDocument(marked, a.documentId, (doc) =>
      updateDocumentHtml(doc, applyProposal(doc.html, a), a.now),
    );
    return { ...applied, tabs: openTab(applied.tabs, a.documentId) };
  },
  'transcript/filter': (s, a) => ({ ...s, transcriptFilter: a.speechId }),
  'palette/open': (s) => ({ ...s, paletteOpen: true }),
  'palette/close': (s) => ({ ...s, paletteOpen: false }),
  'page/tone': (s, a) => ({
    ...s,
    pages: { ...s.pages, [a.documentId]: a.tone },
  }),
};

/** The room's one transition: every change a debater makes goes through it. */
export function reduceRoom(round: RoundSnapshot) {
  return (state: RoomState, action: RoomAction): RoomState =>
    (reducers[action.type] as Reducer<typeof action.type>)(
      state,
      action as never,
      round,
    );
}
