import {
  createBrowserConnectionStore,
  onDocumentVisibilityChange,
  systemScheduler,
} from '../realtime/browser-adapters';

/**
 * The real browser edges of resource sync: the monotonic clock, the
 * document's visibility and, when realtime is configured, a connection.
 */
export function browserSyncEdges(socketUrl: string | null) {
  return {
    scheduler: systemScheduler,
    visibility: {
      isVisible: () => document.visibilityState === 'visible',
      onVisible: (listener: () => void) =>
        onDocumentVisibilityChange((visible) => {
          if (visible) listener();
        }),
    },
    connection:
      socketUrl === null ? null : createBrowserConnectionStore(socketUrl),
  };
}
