import {
  appendMessage,
  markRead,
  type ChatMessage,
} from '../../features/debate-room/chat';
import {
  cancelEndSpeech,
  pressEndSpeech,
  type EndSpeechState,
} from '../../features/debate-room/clock';
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
  nudgePane,
  resizePane,
  selectMode,
  togglePanel,
  type LayoutMode,
  type LayoutState,
  type Pane,
  type Panel,
} from '../../features/debate-room/layout';
import {
  activateTab,
  loadWorkspaceDocuments,
  appendWorkspaceDocument,
  closeTab,
  openTab,
  sidebarTabs,
  type SidebarTab,
  type TabsState,
} from '../../features/debate-room/workspace';
import type { AgentTurn, RoundSnapshot } from './round';

export type PageTone = 'dark' | 'light';
export type EditOutcome = 'applied' | 'discarded';

export type RoomState = {
  readonly layout: LayoutState;
  readonly tabs: TabsState;
  readonly documents: readonly WorkspaceDocument[];
  readonly sidebar: SidebarTab;
  readonly channelId: string;
  readonly agentId: string;
  readonly messages: readonly ChatMessage[];
  readonly readMarkers: Readonly<Record<string, string>>;
  readonly edits: Readonly<Record<string, EditOutcome>>;
  readonly asked: Readonly<Record<string, readonly AgentTurn[]>>;
  readonly transcriptFilter: string;
  readonly paletteOpen: boolean;
  readonly endSpeech: EndSpeechState;
  /** Each document's page tone; a document not listed is dark. */
  readonly pages: Readonly<Record<string, PageTone>>;
};

export type RoomAction =
  | {
      readonly type: 'layout/mode';
      readonly mode: Exclude<LayoutMode, 'custom'>;
    }
  | { readonly type: 'layout/panel'; readonly panel: Panel }
  | {
      readonly type: 'layout/resize';
      readonly pane: Pane;
      readonly startPx: number;
      readonly deltaPx: number;
    }
  | { readonly type: 'layout/nudge'; readonly pane: Pane; readonly key: string }
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
  | { readonly type: 'sidebar/tab'; readonly tab: SidebarTab }
  | {
      readonly type: 'sidebar/channel';
      readonly channelId: string;
      readonly now: string;
    }
  | { readonly type: 'sidebar/agent'; readonly agentId: string }
  | { readonly type: 'chat/send'; readonly message: ChatMessage }
  | {
      readonly type: 'agent/ask';
      readonly agentId: string;
      readonly turn: AgentTurn;
    }
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
  | { readonly type: 'end/press' }
  | { readonly type: 'end/cancel' }
  | {
      readonly type: 'page/tone';
      readonly documentId: string;
      readonly tone: PageTone;
    };

const CHAT_MAX_LENGTH = 2000;

const firstRoundDocument = (round: RoundSnapshot) =>
  round.documents.find((doc) => doc.folder === 'round')?.id ?? null;

export function initialRoomState(round: RoundSnapshot): RoomState {
  const first = firstRoundDocument(round);
  const roundDocs = round.documents
    .filter((doc) => doc.folder === 'round')
    .map((doc) => doc.id);
  return {
    layout: initialLayout,
    tabs: { open: roundDocs, active: first },
    documents: round.documents,
    sidebar: sidebarTabs(round.kind)[0] ?? 'chat',
    channelId: 'round',
    agentId: round.agents[0]?.id ?? '',
    messages: round.messages,
    readMarkers: {},
    edits: {},
    asked: {},
    transcriptFilter: 'all',
    paletteOpen: false,
    endSpeech: 'idle',
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
  'layout/mode': (s, a) => ({ ...s, layout: selectMode(s.layout, a.mode) }),
  'layout/panel': (s, a) => ({ ...s, layout: togglePanel(s.layout, a.panel) }),
  'layout/resize': (s, a, r) => ({
    ...s,
    layout: resizePane(s.layout, r.phase, a.pane, a.startPx, a.deltaPx),
  }),
  'layout/nudge': (s, a, r) => ({
    ...s,
    layout: nudgePane(s.layout, r.phase, a.pane, a.key),
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
  'sidebar/tab': (s, a, r) =>
    sidebarTabs(r.kind).includes(a.tab) ? { ...s, sidebar: a.tab } : s,
  'sidebar/channel': (s, a) => ({
    ...s,
    channelId: a.channelId,
    readMarkers: markRead(s.readMarkers, a.channelId, a.now),
  }),
  'sidebar/agent': (s, a) => ({ ...s, agentId: a.agentId }),
  'chat/send': (s, a) => ({
    ...s,
    messages: appendMessage(s.messages, a.message, CHAT_MAX_LENGTH),
  }),
  'agent/ask': (s, a) =>
    a.turn.text.trim() === ''
      ? s
      : {
          ...s,
          asked: {
            ...s.asked,
            [a.agentId]: [...(s.asked[a.agentId] ?? []), a.turn],
          },
        },
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
  'end/press': (s) => ({ ...s, endSpeech: pressEndSpeech(s.endSpeech) }),
  'end/cancel': (s) => ({ ...s, endSpeech: cancelEndSpeech(s.endSpeech) }),
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
