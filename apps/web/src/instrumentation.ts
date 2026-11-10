import type { Instrumentation } from 'next';

// Next builds this file for both runtimes, so every Node-only import sits
// behind the statically-inlined runtime gate — the docs' own pattern — and
// the edge bundle contains none of the server composition. The app's
// logger, from validated config, is what the nodejs runtime logs through.
export async function register() {
  // ADR 0037: each runtime initializes its own scrubbed adapter, gated on
  // its own variable; an unset DSN leaves the SDK uninitialized and no
  // runtime makes any Sentry network call.
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./features/telemetry/sentry.edge.config');
    return;
  }
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  await import('./features/telemetry/sentry.server.config');
  const { processApp, initializeProcessBilling } =
    await import('./server/process-app');
  const { loadBillingRoutes } = await import('./server/billing-route-loader');
  initializeProcessBilling(loadBillingRoutes);
  // Provider-neutral spans bind to the host's OTel provider. Exporters belong to deployment.
  processApp().logger.log(
    'runtime.initialize',
    { operation: 'runtime.initialize' },
    'Application runtime initialized',
  );
}
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const [{ processApp }, { reportRequestError }] = await Promise.all([
    import('./server/process-app'),
    import('./server/request-failure'),
  ]);
  const id = request.headers['x-request-id'];
  const app = processApp();
  // ADR 0037: the log line carries the error's own code; the raw exception
  // reaches only the scrubbed reporter, and only for a 5xx or an invariant.
  reportRequestError({
    error,
    requestId: typeof id === 'string' ? id : undefined,
    route: context.routePath,
    logger: app.logger,
    reporter: app.reporter,
  });
};
