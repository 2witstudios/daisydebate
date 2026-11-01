import {
  updateDocumentHtml,
  type WorkspaceDocument,
} from '../../features/debate-room/documents/documents';
import {
  activateTab,
  closeTab,
  openTab,
  loadWorkspaceDocuments,
  appendWorkspaceDocument,
  type TabsState,
} from '../../features/debate-room/workspace';
import type { RoomAction } from './room-state';
import type { PageTone } from '../document-editor/document-editor';
import type { RecoveredDraft } from './document-sync';

type State = {
  readonly documents: readonly WorkspaceDocument[];
  readonly tabs: TabsState;
  readonly pages: Readonly<Record<string, PageTone>>;
  readonly paletteOpen: boolean;
  /** Recovered local drafts awaiting an explicit restore/discard choice. */
  readonly recovered: ReadonlyMap<string, RecoveredDraft>;
};
export const initialPersistedWorkspace: State = {
  documents: [],
  tabs: { open: [], active: null },
  pages: {},
  paletteOpen: false,
  recovered: new Map(),
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
    case 'doc/recovered':
      return { ...state, recovered: action.recovered };
    case 'doc/recovered/restore': {
      const draft = state.recovered.get(action.id);
      if (!draft) return state;
      return {
        ...state,
        recovered: new Map(
          [...state.recovered].filter(([id]) => id !== action.id),
        ),
        documents: state.documents.map((doc) =>
          doc.id === action.id
            ? updateDocumentHtml(doc, draft.html, action.now)
            : doc,
        ),
        tabs: openTab(state.tabs, action.id),
      };
    }
    case 'doc/recovered/discard':
      return {
        ...state,
        recovered: new Map(
          [...state.recovered].filter(([id]) => id !== action.id),
        ),
      };
    case 'page/tone':
      return {
        ...state,
        pages: { ...state.pages, [action.documentId]: action.tone },
      };
    default:
      return state;
  }
}
