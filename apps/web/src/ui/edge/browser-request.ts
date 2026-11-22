type BrowserFetch = Window['fetch'];
export type BrowserRequest = Parameters<BrowserFetch>;

/** Uses the current transport, including instrumentation installed on the tab. */
export const browserFetch: BrowserFetch = (input, init) => fetch(input, init);

export const currentBrowserFetch = (): BrowserFetch =>
  window.fetch.bind(window);

/** Installs an observer for the active route's requests until its owner exits. */
export function interceptBrowserFetch(
  intercept: (request: BrowserRequest, send: BrowserFetch) => Promise<Response>,
  host: Pick<Window, 'fetch'> = window,
): () => void {
  const send = host.fetch.bind(host);
  const wrapped: BrowserFetch = (...request) => intercept(request, send);
  host.fetch = wrapped;
  return () => {
    if (host.fetch === wrapped) host.fetch = send;
  };
}
