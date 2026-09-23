import type { Instrumentation } from 'next';
import type { LogLevel } from '@daisy/logger';

const LOG_LEVELS = new Set<LogLevel>([
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
]);
const asLogLevel = (value: string | undefined): LogLevel =>
  LOG_LEVELS.has(value as LogLevel) ? (value as LogLevel) : 'info';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Provider-neutral spans bind to the host's OTel provider. Exporters belong to deployment.
    const { createLogger } = await import('@daisy/logger');
    createLogger({
      service: 'web',
      level: asLogLevel(process.env.LOG_LEVEL),
      appVersion: process.env.APP_VERSION ?? 'development',
      gitCommit: process.env.GIT_COMMIT ?? 'unknown',
    }).log(
      'runtime.initialize',
      { operation: 'runtime.initialize' },
      'Application runtime initialized',
    );
  }
}
export const onRequestError: Instrumentation.onRequestError = async (
  _error,
  request,
  context,
) => {
  const { createLogger } = await import('@daisy/logger');
  const id = request.headers['x-request-id'];
  createLogger({
    service: 'web',
    level: asLogLevel(process.env.LOG_LEVEL),
    appVersion: process.env.APP_VERSION ?? 'development',
    gitCommit: process.env.GIT_COMMIT ?? 'unknown',
  }).log(
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
