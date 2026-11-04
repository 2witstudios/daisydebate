import { markRead, type ChatMessage } from '../../features/debate-room/chat';
import { applyProposal } from '../../features/documents/document-edits';
import {
  updateDocumentHtml,
  type MemberDocument,
} from '../../features/documents/document';
import {
  openTab,
  type OpenDocument,
} from '../../features/documents/open-documents';
import {
  initialManagerState,
  isManagerAction,
  reduceManager,
  type ManagerAction,
  type ManagerState,
  type PageTone,
} from '../../features/documents/document-manager-state';
import {
  sidebarTabs,
  type PhonePanel,
  type PhoneView,
  type SidebarTab,
} from '../../features/debate-room/workspace';
import type { RoundSnapshot } from './round';

export type EditOutcome = 'applied' | 'discarded';

export type RoomState = ManagerState & {
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
};

export type RoomAction =
  | ManagerAction
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
    };

export function initialRoomState(round: RoundSnapshot): RoomState {
  return {
    ...initialManagerState(),
    sidebar: 'transcript',
    filesOpen: true,
    phone: 'doc',
    openChannelId: null,
    agentId: round.agents[0]?.id ?? '',
    messages: round.messages,
    readMarkers: {},
    edits: {},
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
  change: (doc: MemberDocument) => MemberDocument,
): RoomState => ({
  ...state,
  opened: state.opened.map((open): OpenDocument =>
    open.kind === 'loaded' && open.document.id === id
      ? { kind: 'loaded', document: change(open.document) }
      : open,
  ),
});

type Reducer<T extends RoomAction['type']> = (
  state: RoomState,
  action: Extract<RoomAction, { type: T }>,
) => RoomState;

type RoundAction = Exclude<RoomAction, ManagerAction>;

const reducers: { readonly [T in RoundAction['type']]: Reducer<T> } = {
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
};

/** The room's one transition: every change a debater makes goes through it. */
export function reduceRoom(state: RoomState, action: RoomAction): RoomState {
  if (isManagerAction(action)) {
    const next = reduceManager(state, action);
    return action.type === 'tabs/open' || action.type === 'doc/add'
      ? { ...next, phone: fromFiles(next.phone) }
      : next;
  }
  return (reducers[action.type] as Reducer<RoundAction['type']>)(
    state,
    action as never,
  );
}
