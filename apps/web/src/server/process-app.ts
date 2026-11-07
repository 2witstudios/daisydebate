import { systemClock, systemId } from '@daisy/clock';
import { createApp, type App } from './app';
import { betaMessagingPolicy } from '../features/messaging/beta-policy';
import type { Fetch } from '../features/mail/resend-sender';
import { captureMail, fileRecorder, readDevMailFile } from './dev-mail';
import { createProcessEdge, type ProcessHolder } from './process-edge';
import { createRouteBinder } from './route-binding';
import { createRoutes, type Routes } from './routes';
import { createLazyBillingRoutes } from './billing-route-table';
import { readStartOptions } from './start-options';
import { nextWorkerToken } from './worker-token';
import { fetchWithoutTracing } from '../features/telemetry/sentry-init';

/**
 * The web process edge, and the only module that reads `process.env` or
 * `globalThis` (eslint.config.mjs, ISSUE-7 block: no-restricted-properties
 * and no-restricted-globals). Next loads route modules, the proxy and
 * instrumentation as separate bundles that share only `globalThis`, so the
 * one app this server process runs is kept there, built on first use from
 * the real environment, fetch, clock and ids. Only route bindings and the
 * process entries import this module (no-restricted-imports); everything
 * else receives the app, or a part of it, as an argument, and tests build
 * their own with `createApp`.
 */
type ProcessState = {
  readonly app: App;
  readonly routes: Routes & {
    readonly billing: ReturnType<typeof createLazyBillingRoutes>;
  };
  readonly vendorFetch: typeof globalThis.fetch;
};

const stateFor = (
  app: App,
  vendorFetch: typeof globalThis.fetch,
): ProcessState => ({
  app,
  routes: {
    ...createRoutes(app),
    billing: createLazyBillingRoutes(app, vendorFetch),
  },
  vendorFetch,
});

/**
 * Outbound HTTP: the network, except in local development with
 * `DEV_MAIL_CAPTURE` set, where sign-in mail is kept in that file instead of
 * sent (production refuses the variable).
 */
const outboundFetch = (env: Record<string, string | undefined>): Fetch => {
  const file = readDevMailFile(env);
  return file === null
    ? globalThis.fetch
    : captureMail({
        downstream: globalThis.fetch,
        record: fileRecorder(file),
        clock: systemClock,
      });
};

/** Public probe reaches real ingress, independently of captured outbound mail. */
export const fetchPublicAttendanceProbe = (url: string, init: RequestInit) =>
  fetchWithoutTracing(url, init, globalThis.fetch);

/** Process-owned vendor transport; workers receive it explicitly and never read globals. */
export const processVendorFetch = (): typeof globalThis.fetch =>
  edge.get().vendorFetch;

const edge = createProcessEdge(
  globalThis as typeof globalThis & ProcessHolder<ProcessState>,
  () =>
    stateFor(
      createApp({
        env: process.env,
        fetch: outboundFetch(process.env),
        clock: systemClock,
        ids: systemId,
        nextWorkerToken,
        messagingPolicy: betaMessagingPolicy,
      }),
      globalThis.fetch,
    ),
);

/** This process's app, built on first use. */
export const processApp = (): App => edge.get().app;

/** Binds a Next route export to this process's route table. */
export const processRoute = (
  pick: (
    routes: ProcessState['routes'],
    app: App,
    fetch: typeof globalThis.fetch,
  ) => (request: Request) => Promise<Response>,
) =>
  createRouteBinder(() => edge.get())((state) =>
    pick(state.routes, state.app, state.vendorFetch),
  );
/**
 * For a process entry that composes its own app before the server starts
 * (the browser suite's server, which captures outbound mail): makes it this
 * process's app. Refuses once one exists.
 */
export const adoptProcessApp = (
  app: App,
  vendorFetch: typeof globalThis.fetch = globalThis.fetch,
) => edge.adopt(stateFor(app, vendorFetch));

/** Closes this process's app if one was built. */
export async function closeProcessApp() {
  await edge.held()?.app.close();
}

/** The production server's validated launch settings. */
export const processStartOptions = () => readStartOptions(process.env);
