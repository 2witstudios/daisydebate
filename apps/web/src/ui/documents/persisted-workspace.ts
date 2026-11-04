import {
  adoptServerText,
  updateDocumentHtml,
  type MemberDocument,
} from '../../features/documents/document';
import {
  activateTab,
  closeTab,
  openTab,
  loadWorkspaceDocuments,
  appendWorkspaceDocument,
  type TabsState,
} from '../../features/documents/open-documents';
import type { RoomAction } from '../debate-room/room-state';
import type { PageTone } from '../document-editor/document-editor';

type State = {
  readonly documents: readonly MemberDocument[];
  readonly tabs: TabsState;
  readonly pages: Readonly<Record<string, PageTone | null>>;
  readonly paletteOpen: boolean;
};
export const initialPersistedWorkspace: State = {
  documents: [],
  tabs: { open: [], active: null },
  pages: {},
  paletteOpen: false,
};
function tabs(state: State, action: RoomAction): State | null {
  switch (action.type) {
    case 'tabs/open':
      return { ...state, tabs: openTab(state.tabs, action.id) };
    case 'tabs/close':
      return { ...state, tabs: closeTab(state.tabs, action.id) };
    case 'tabs/activate':
      return { ...state, tabs: activateTab(state.tabs, action.id) };
    default:
      return null;
  }
}
/** Document-only state; never invents a floor, clock, speaker or assistant. */
export function reducePersistedWorkspace(
  state: State,
  action: RoomAction,
): State {
  const changed = tabs(state, action);
  if (changed) return changed;
  switch (action.type) {
    case 'doc/loaded':
      return loadWorkspaceDocuments(state, action.documents);
    case 'doc/add':
      return appendWorkspaceDocument(state, action.document);
    case 'doc/server-text':
      return {
        ...state,
        documents: state.documents.map((d) =>
          d.id === action.id ? adoptServerText(d, action.html, action.now) : d,
        ),
      };
    case 'doc/update':
      return {
        ...state,
        documents: state.documents.map((d) =>
          d.id === action.id
            ? updateDocumentHtml(d, action.html, action.now)
            : d,
        ),
      };
    case 'palette/open':
      return { ...state, paletteOpen: true };
    case 'palette/close':
      return { ...state, paletteOpen: false };
    case 'page/tone':
      return {
        ...state,
        pages: { ...state.pages, [action.documentId]: action.tone },
      };
    default:
      return state;
  }
}
