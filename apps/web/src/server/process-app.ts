import { systemClock, systemId } from '@daisy/clock';
import { createApp, type App } from './app';
import type { Fetch } from '../features/auth/mail/mail';
import { captureMail, fileRecorder, readDevMailFile } from './dev-mail';
import { createProcessEdge, type ProcessHolder } from './process-edge';
import { createRouteBinder } from './route-binding';
import { createRoutes, type Routes } from './routes';
import { readStartOptions } from './start-options';

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
type ProcessState = { readonly app: App; readonly routes: Routes };

const stateFor = (app: App): ProcessState => ({
  app,
  routes: createRoutes(app),
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

const edge = createProcessEdge(
  globalThis as typeof globalThis & ProcessHolder<ProcessState>,
  () =>
    stateFor(
      createApp({
        env: process.env,
        fetch: outboundFetch(process.env),
        clock: systemClock,
        ids: systemId,
      }),
    ),
);

/** This process's app, built on first use. */
export const processApp = (): App => edge.get().app;

/** Binds a Next route export to this process's route table. */
export const processRoute = createRouteBinder(() => edge.get().routes);
/** Two channel-metadata GET bindings share route-param resolution without request-selected authority. */
export function processMessagingChannelRead(
  operation: 'typing' | 'preferences',
) {
  return (
    request: Request,
    context: { params: Promise<{ channelId: string }> },
  ) =>
    processRoute((routes) => async (incoming) => {
      const { channelId } = await context.params;
      return operation === 'typing'
        ? routes.messaging.typing(incoming, false, channelId)
        : routes.messaging.preferences(incoming, 'read', channelId);
    })(request);
}

/**
 * For a process entry that composes its own app before the server starts
 * (the browser suite's server, which captures outbound mail): makes it this
 * process's app. Refuses once one exists.
 */
export const adoptProcessApp = (app: App) => edge.adopt(stateFor(app));

/** Closes this process's app if one was built. */
export async function closeProcessApp() {
  await edge.held()?.app.close();
}

/** The production server's validated launch settings. */
export const processStartOptions = () => readStartOptions(process.env);

/** Whether Next is running this bundle on the Node.js runtime. */
export const isNodeRuntime = () => process.env.NEXT_RUNTIME === 'nodejs';
