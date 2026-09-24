import { createBrowserConnectionStore } from '../../src/features/realtime/browser-adapters';

/**
 * Bundled at test time (`realtime-harness.ts`) and injected into a real page
 * so `realtime-connection-store.e2e.ts` can drive the actual
 * `createBrowserConnectionStore` production wiring (real `WebSocket`,
 * `fetch`, `Date.now`/`setTimeout`, `document.visibilitychange`) in a real
 * browser against the real `apps/realtime` scaffold. The test stubs
 * `window.fetch`'s answer for `/api/realtime/ticket` (RT-2.4a is a parallel,
 * unmerged leaf), not this module.
 */
declare global {
  interface Window {
    __daisyRealtimeHarness: typeof createBrowserConnectionStore;
  }
}
window.__daisyRealtimeHarness = createBrowserConnectionStore;
