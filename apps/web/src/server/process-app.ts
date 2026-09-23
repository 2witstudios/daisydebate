import { systemClock, systemId } from '@daisy/clock';
import { createApp, type App } from './app';
import { createRouteBinder } from './route-binding';
import { createRoutes, type Routes } from './routes';
import { readStartOptions } from './start-options';

/**
 * The process edge, and the only module that reads `process.env` or
 * `globalThis` (the ESLint `daisy/process-edge` rule enforces it). Next
 * loads route modules, the proxy and instrumentation as separate bundles
 * that share only `globalThis`, so the one app this server process runs is
 * kept there, built on first use from the real environment, fetch, clock
 * and ids. Everything else receives the app, or a part of it, as an
 * argument; tests build their own with `createApp`.
 */
type ProcessState = { readonly app: App; readonly routes: Routes };

const processState = globalThis as typeof globalThis & {
  daisyWebApp?: ProcessState;
};

function processWeb(): ProcessState {
  if (processState.daisyWebApp) return processState.daisyWebApp;
  const app = createApp({
    env: process.env,
    fetch: globalThis.fetch,
    clock: systemClock,
    ids: systemId,
  });
  processState.daisyWebApp = { app, routes: createRoutes(app) };
  return processState.daisyWebApp;
}

/**
 * For a process entry that composes its own app before the server starts
 * (the browser suite's server, which captures outbound mail): makes it this
 * process's app. Refuses once one exists, so it can never swap an app out
 * from under requests.
 */
export function adoptProcessApp(app: App) {
  if (processState.daisyWebApp)
    throw new Error('This process already runs an app');
  processState.daisyWebApp = { app, routes: createRoutes(app) };
}

/** This process's app, built on first use. */
export const processApp = (): App => processWeb().app;

/** Binds a Next route export to this process's route table. */
export const processRoute = createRouteBinder(() => processWeb().routes);

/** Closes this process's app if one was built. */
export async function closeProcessApp() {
  await processState.daisyWebApp?.app.close();
}

/** The production server's validated launch settings. */
export const processStartOptions = () => readStartOptions(process.env);

/** Whether Next is running this bundle on the Node.js runtime. */
export const isNodeRuntime = () => process.env.NEXT_RUNTIME === 'nodejs';
