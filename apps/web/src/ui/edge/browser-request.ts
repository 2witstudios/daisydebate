/**
 * The browser's request transport as one port. Outside the edge it is
 * injected into the client that makes requests (a driver, an HTTP client, an
 * upload), never called by a component. It reads the tab's current `fetch`
 * at each request, so instrumentation installed on the tab still sees it.
 */
export type BrowserTransport = Window['fetch'];

export const browserTransport: BrowserTransport = (input, init) =>
  window.fetch(input, init);
