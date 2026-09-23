import type { Instrumentation } from 'next';

// The app's logger, from validated config, is the one both hooks use. The
// process edge is imported lazily, keeping this file free of server code.
const edge = () => import('./server/process-app');

export async function register() {
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
  _error,
  request,
  context,
) => {
  const { processApp } = await edge();
  const id = request.headers['x-request-id'];
  processApp().logger.log(
    'request.unhandled',
    {
      operation: 'request.unhandled',
      requestId: typeof id === 'string' ? id : undefined,
      route: context.routePath,
      errorCode: 'INTERNAL',
    },
    'Unhandled request failure',
  );
};
