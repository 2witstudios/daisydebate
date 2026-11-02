import { markRead, type ChatMessage } from '../../features/debate-room/chat';
import type { PageTone } from '../document-editor/document-editor';
import { applyProposal } from '../../features/debate-room/documents/document-edits';
import {
  createDocument,
  adoptServerText,
  updateDocumentHtml,
  type WorkspaceDocument,
} from '../../features/debate-room/documents/documents';
import {
  activateTab,
  loadWorkspaceDocuments,
  appendWorkspaceDocument,
  closeTab,
  sidebarTabs,
  openTab,
  type PhonePanel,
  type PhoneView,
  type SidebarTab,
  type TabsState,
} from '../../features/debate-room/workspace';
import type { RoundSnapshot } from './round';

export type EditOutcome = 'applied' | 'discarded';

export type RoomState = {
  readonly tabs: TabsState;
  readonly documents: readonly WorkspaceDocument[];
  /** The right sidebar's tab; it never closes on its own. */
  readonly sidebar: SidebarTab;
  /** The Files sidebar on a wide screen; open by default. */
  readonly filesOpen: boolean;
  /** The one region a phone shows; the document by default. */
  readonly phone: PhoneView;
  /** The channel open in the sidebar; null shows the list. */
  readonly openChannelId: string | null;
  readonly agentId: string;
  readonly messages: readonly ChatMessage[];
  readonly readMarkers: Readonly<Record<string, string>>;
  readonly edits: Readonly<Record<string, EditOutcome>>;
  readonly paletteOpen: boolean;
  /** A viewer's page tone per document; one not listed follows their theme. */
  readonly pages: Readonly<Record<string, PageTone | null>>;
};

export type RoomAction =
  | { readonly type: 'tabs/open'; readonly id: string }
  | { readonly type: 'tabs/activate'; readonly id: string }
  | { readonly type: 'tabs/close'; readonly id: string }
  | {
      readonly type: 'doc/create';
      readonly id: string;
      readonly now: string;
    }
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
      readonly documents: readonly WorkspaceDocument[];
    }
  | { readonly type: 'doc/add'; readonly document: WorkspaceDocument }
  | { readonly type: 'sidebar/tab'; readonly tab: SidebarTab }
  | { readonly type: 'files/toggle' }
  | { readonly type: 'phone/panel'; readonly panel: PhonePanel }
  | {
      readonly type: 'channel/open';
      readonly channelId: string;
      readonly now: string;
    }
  | { readonly type: 'channel/list' }
  | { readonly type: 'agent/select'; readonly agentId: string }
  | {
      readonly type: 'agent/edit';
      readonly turnId: string;
      readonly outcome: EditOutcome;
      readonly documentId: string;
      readonly removed: readonly string[];
      readonly added: readonly string[];
      readonly now: string;
    }
  | { readonly type: 'palette/open' }
  | { readonly type: 'palette/close' }
  | {
      readonly type: 'page/tone';
      readonly documentId: string;
      readonly tone: PageTone | null;
    };

export function initialRoomState(round: RoundSnapshot): RoomState {
  return {
    tabs: { open: [], active: null },
    documents: round.documents,
    sidebar: 'transcript',
    filesOpen: true,
    phone: 'doc',
    openChannelId: null,
    agentId: round.agents[0]?.id ?? '',
    messages: round.messages,
    readMarkers: {},
    edits: {},
    paletteOpen: false,
    pages: {},
  };
}

/** The panel a phone shows, for its tab bar and its focus return. */
export const phonePanelOf = (state: RoomState): PhonePanel =>
  state.phone === 'sidebar' ? state.sidebar : state.phone;

/** The viewer's page tone for a document; null follows their theme. */
export const pageToneOf = (
  state: RoomState,
  documentId: string,
): PageTone | null => state.pages[documentId] ?? null;

/** Opening a file from a phone's Files panel shows the file. */
const fromFiles = (phone: PhoneView): PhoneView =>
  phone === 'files' ? 'doc' : phone;

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
) => RoomState;

const reducers: { readonly [T in RoomAction['type']]: Reducer<T> } = {
  'tabs/open': (s, a) => ({
    ...s,
    tabs: openTab(s.tabs, a.id),
    phone: fromFiles(s.phone),
  }),
  'tabs/activate': (s, a) => ({ ...s, tabs: activateTab(s.tabs, a.id) }),
  'tabs/close': (s, a) => ({ ...s, tabs: closeTab(s.tabs, a.id) }),
  'doc/create': (s, a) => {
    const doc = createDocument({
      id: a.id,
      now: a.now,
      existingTitles: s.documents.map((d) => d.title),
    });
    return {
      ...s,
      documents: [...s.documents, doc],
      tabs: openTab(s.tabs, doc.id),
      phone: fromFiles(s.phone),
      paletteOpen: false,
    };
  },
  'doc/update': (s, a) =>
    withDocument(s, a.id, (doc) => updateDocumentHtml(doc, a.html, a.now)),
  'doc/server-text': (s, a) =>
    withDocument(s, a.id, (doc) => adoptServerText(doc, a.html, a.now)),
  'doc/loaded': (s, a) => loadWorkspaceDocuments(s, a.documents),
  'doc/add': (s, a) => ({
    ...appendWorkspaceDocument(s, a.document),
    phone: fromFiles(s.phone),
  }),
  'sidebar/tab': (s, a) => ({ ...s, sidebar: a.tab }),
  'files/toggle': (s) => ({ ...s, filesOpen: !s.filesOpen }),
  'phone/panel': (s, a) => {
    const tab = sidebarTabs.find((candidate) => candidate === a.panel);
    if (tab) return { ...s, phone: 'sidebar', sidebar: tab };
    return { ...s, phone: a.panel as Exclude<PhoneView, 'sidebar'> };
  },
  'channel/open': (s, a) => ({
    ...s,
    openChannelId: a.channelId,
    readMarkers: markRead(s.readMarkers, a.channelId, a.now),
  }),
  'channel/list': (s) => ({ ...s, openChannelId: null }),
  'agent/select': (s, a) => ({ ...s, agentId: a.agentId }),
  'agent/edit': (s, a) => {
    if (s.edits[a.turnId]) return s;
    const marked = { ...s, edits: { ...s.edits, [a.turnId]: a.outcome } };
    if (a.outcome === 'discarded') return marked;
    const applied = withDocument(marked, a.documentId, (doc) =>
      updateDocumentHtml(doc, applyProposal(doc.html, a), a.now),
    );
    return { ...applied, tabs: openTab(applied.tabs, a.documentId) };
  },
  'palette/open': (s) => ({ ...s, paletteOpen: true }),
  'palette/close': (s) => ({ ...s, paletteOpen: false }),
  'page/tone': (s, a) => ({
    ...s,
    pages: { ...s.pages, [a.documentId]: a.tone },
  }),
};

/** The room's one transition: every change a debater makes goes through it. */
export function reduceRoom(state: RoomState, action: RoomAction): RoomState {
  return (reducers[action.type] as Reducer<typeof action.type>)(
    state,
    action as never,
  );
}
