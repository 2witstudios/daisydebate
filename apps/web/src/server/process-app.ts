import { systemClock, systemId } from '@daisy/clock';
import { hostWaits } from '@daisy/worker/host';
import { createApp, type App } from './app';
import type { Fetch } from '../features/mail/resend-sender';
import { captureMail, fileRecorder, readDevMailFile } from './dev-mail';
import { createProcessEdge, type ProcessHolder } from './process-edge';
import { createRouteBinder } from './route-binding';
import { composedOn, type Composed, type Composition } from './composition';
import { createRoutes, type Routes } from './routes';
import {
  createLazyBillingRoutes,
  type BillingRouteLoader,
} from './billing-route-table';
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
  /** Each feature composition built on this app, by name. */
  readonly composed: Composed;
  readonly initializeBilling: (load: BillingRouteLoader) => void;
};

const stateFor = (
  app: App,
  vendorFetch: typeof globalThis.fetch,
): ProcessState => {
  let billingLoader: BillingRouteLoader | undefined;
  return {
    app,
    routes: {
      ...createRoutes(app),
      billing: createLazyBillingRoutes(app, vendorFetch, () => {
        if (!billingLoader)
          throw new Error('Billing bootstrap is not initialized');
        return billingLoader();
      }),
    },
    vendorFetch,
    composed: new Map(),
    initializeBilling: (load) => {
      billingLoader ??= load;
    },
  };
};

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

/** The originating bootstrap installs once; later Next instrumentation cannot replace it. */
export const initializeProcessBilling = (load: BillingRouteLoader) =>
  edge.get().initializeBilling(load);

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

/** The legacy table: shrinks to nothing as each feature binds its own composition. */
type LegacyPick<Args extends unknown[]> = Pick<ProcessState['routes'], Args>;

const isComposition = (value: unknown): value is Composition<unknown> =>
  typeof value === 'object' && value !== null && 'compose' in value;

/** `composition`'s handlers on the state's app, built once per app. */
const routesOf = <Routes>(
  state: ProcessState,
  composition: Composition<Routes>,
): Routes =>
  composedOn(
    state.composed,
    state.app,
    { vendorFetch: state.vendorFetch },
    composition,
  );

const selectOn = <Routes, Args extends unknown[]>(
  composition: Composition<Routes> | null,
  pick: Pick<Routes, Args> | LegacyPick<Args>,
) =>
  composition
    ? (state: ProcessState) =>
        (pick as Pick<Routes, Args>)(
          routesOf(state, composition),
          state.app,
          state.vendorFetch,
        )
    : (state: ProcessState) =>
        (pick as LegacyPick<Args>)(state.routes, state.app, state.vendorFetch);

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

function bindRequestRoute<Routes>(
  composition: Composition<Routes>,
  pick: Pick<Routes, []>,
): Handler<[]> & { readonly bindTo: (app: App) => Handler<[]> };
function bindRequestRoute(
  pick: LegacyPick<[]>,
): Handler<[]> & { readonly bindTo: (app: App) => Handler<[]> };
function bindRequestRoute<Routes>(
  first: Composition<Routes> | LegacyPick<[]>,
  pick?: Pick<Routes, []>,
) {
  const bound = isComposition(first)
    ? bind(selectOn(first, pick as Pick<Routes, []>))
    : bind(selectOn<Routes, []>(null, first));
  return Object.assign((request: Request) => bound(request), {
    bindTo: bound.bindTo,
  });
}

const withParams =
  <Params>(handler: Handler<[Params]>) =>
  async (request: Request, { params }: { params: Promise<Params> }) =>
    handler(request, await params);

function bindParameterizedRoute<Routes, Params>(
  composition: Composition<Routes>,
  pick: Pick<Routes, [Params]>,
): ReturnType<typeof bindNextParams<Params>>;
function bindParameterizedRoute<Params>(
  pick: LegacyPick<[Params]>,
): ReturnType<typeof bindNextParams<Params>>;
function bindParameterizedRoute<Routes, Params>(
  first: Composition<Routes> | LegacyPick<[Params]>,
  pick?: Pick<Routes, [Params]>,
) {
  const select = isComposition(first)
    ? selectOn(first, pick as Pick<Routes, [Params]>)
    : selectOn<Routes, [Params]>(null, first);
  return bindNextParams<Params>(select);
}

function bindNextParams<Params>(
  select: (state: ProcessState) => Handler<[Params]>,
) {
  return bind((state) => withParams(select(state)));
}

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
