import { systemClock, systemId } from '@daisy/clock';
import { hostWaits } from '@daisy/worker/host';
import { createApp, type App } from './app';
import type { Fetch } from '../features/mail/resend-sender';
import { captureMail, fileRecorder, readDevMailFile } from './dev-mail';
import { createProcessEdge, type ProcessHolder } from './process-edge';
import { createRouteBinder } from './route-binding';
import { composedOn, type Composed, type Composition } from './composition';
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
  readonly vendorFetch: typeof globalThis.fetch;
  /** Each feature composition built on this app, by name. */
  readonly composed: Composed;
};

const stateFor = (
  app: App,
  vendorFetch: typeof globalThis.fetch,
): ProcessState => ({ app, vendorFetch, composed: new Map() });

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

type ProcessSlot = typeof globalThis & ProcessHolder<ProcessState>;
/** The process-wide slot: one named property of the host, never the host itself. */
const processHolder: ProcessHolder<ProcessState> = {
  get daisyWebApp() {
    return (globalThis as ProcessSlot).daisyWebApp;
  },
  set daisyWebApp(value) {
    (globalThis as ProcessSlot).daisyWebApp = value;
  },
};
const edge = createProcessEdge(processHolder, () =>
  stateFor(
    createApp({
      env: process.env,
      fetch: outboundFetch(process.env),
      clock: systemClock,
      waits: hostWaits,
      ids: systemId,
      nextWorkerToken,
    }),
    globalThis.fetch,
  ),
);

/** This process's app, built on first use. */
export const processApp = (): App => edge.get().app;

type Handler<Args extends unknown[]> = (
  request: Request,
  ...args: Args
) => Promise<Response>;

/** Picks one handler of a composition; per request, so it may read the app. */
type Pick<Routes, Args extends unknown[]> = (
  routes: Routes,
  app: App,
  fetch: typeof globalThis.fetch,
) => Handler<Args>;

/** `pick` on `composition`, built once per app, on the state's app. */
const selectOn =
  <Routes, Args extends unknown[]>(
    composition: Composition<Routes>,
    pick: Pick<Routes, Args>,
  ) =>
  (state: ProcessState) =>
    pick(
      composedOn(
        state.composed,
        state.app,
        { vendorFetch: state.vendorFetch },
        composition,
      ),
      state.app,
      state.vendorFetch,
    );

/**
 * A route module's handler: `pick` selects it from its feature's
 * composition on this process's app, resolved on the first request so
 * importing the module builds and dials nothing. `bindTo` selects the same
 * handler on an app of the caller's own (tests, the route net).
 */
const bind = <Args extends unknown[]>(
  select: (state: ProcessState) => Handler<Args>,
) =>
  Object.assign(createRouteBinder(() => edge.get())(select), {
    bindTo: (
      app: App,
      vendorFetch: typeof globalThis.fetch = globalThis.fetch,
    ) => select(stateFor(app, vendorFetch)),
  });

const bindRequestRoute = <Routes>(
  composition: Composition<Routes>,
  pick: Pick<Routes, []>,
) => {
  const bound = bind(selectOn(composition, pick));
  return Object.assign((request: Request) => bound(request), {
    bindTo: bound.bindTo,
  });
};

const bindParameterizedRoute = <Routes, Params>(
  composition: Composition<Routes>,
  pick: Pick<Routes, [Params]>,
) => {
  const select = selectOn(composition, pick);
  return bind((state) => {
    const handler = select(state);
    return async (request: Request, { params }: { params: Promise<Params> }) =>
      handler(request, await params);
  });
};

/** Binds request-only handlers or unwraps the directory params supplied by Next. */
export const processRoute = Object.assign(bindRequestRoute, {
  withParams: bindParameterizedRoute,
});

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
