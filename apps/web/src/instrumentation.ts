import type { Instrumentation } from 'next';

// The app's logger, from validated config, is what the nodejs runtime logs
// through. The process edge is imported lazily, keeping this file free of
// server code.
const edge = () => import('./server/process-app');

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
  const { isNodeRuntime, processApp } = await edge();
  if (!isNodeRuntime()) return;
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
  const { processApp } = await edge();
  const id = request.headers['x-request-id'];
  const requestId = typeof id === 'string' ? id : 'unknown';
  const app = processApp();
  app.logger.log(
    'request.unhandled',
    {
      operation: 'request.unhandled',
      requestId: typeof id === 'string' ? id : undefined,
      route: context.routePath,
      errorCode: 'INTERNAL',
    },
    'Unhandled request failure',
  );
  // ADR 0037: the raw exception reaches only the scrubbed reporter, never
  // the log line above.
  app.reporter.capture(error, {
    requestId,
    route: context.routePath,
    errorCode: 'INTERNAL',
  });
};
