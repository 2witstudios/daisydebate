/** Browser events worth reacting to; the recovery owner decides what each one does. */
export function subscribeBrowserPageEvents(input: {
  readonly online: EventTarget;
  readonly visibility: EventTarget;
  readonly isVisible: () => boolean;
  readonly nudge: () => void;
  readonly page: EventTarget;
  /** The document is really going: a frozen, restorable page keeps its lifetime. */
  readonly leaving: () => void;
  /** A frozen page came back: everything it holds may be old. */
  readonly restored: () => void;
}): () => void {
  const online = () => input.nudge();
  const visible = () => {
    if (input.isVisible()) input.nudge();
  };
  const pagehide = (event: Event) => {
    if (!(event as PageTransitionEvent).persisted) input.leaving();
  };
  const pageshow = (event: Event) => {
    if ((event as PageTransitionEvent).persisted) input.restored();
  };
  input.page.addEventListener('pagehide', pagehide);
  input.page.addEventListener('pageshow', pageshow);
  input.online.addEventListener('online', online);
  input.visibility.addEventListener('visibilitychange', visible);
  return () => {
    input.page.removeEventListener('pagehide', pagehide);
    input.page.removeEventListener('pageshow', pageshow);
    input.online.removeEventListener('online', online);
    input.visibility.removeEventListener('visibilitychange', visible);
  };
}
