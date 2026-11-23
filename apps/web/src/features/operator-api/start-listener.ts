import { nowMs } from '@daisy/clock';
import { lookup } from 'node:dns/promises';
import { parseOperatorKeys } from '@daisy/auth/operator-signature';
import { createOperatorApi } from './router';
import { startOperatorListener } from './listener';
import type { ErrorReporter } from '@daisy/observability';
import type { App } from '../../server/app';

/**
 * The private operator listener (ADR 0079), or null when no operator keys
 * are configured. Configured keys that are malformed, or a private address
 * that cannot be bound, reject: the process refuses to start rather than
 * run without the listener it was configured for.
 */
export async function startOperatorApi(app: App, reporter: ErrorReporter) {
  const { config } = app;
  if (config.OPERATOR_API_KEYS === undefined) {
    app.logger.log(
      'operator.listener.disabled',
      { operation: 'operator.listener' },
      'Operator API not configured',
    );
    return null;
  }
  const host = config.OPERATOR_LISTEN_HOST;
  const audience = config.OPERATOR_AUDIENCE;
  if (host === undefined || audience === undefined)
    throw new Error(
      'The config schema requires OPERATOR_LISTEN_HOST and OPERATOR_AUDIENCE whenever OPERATOR_API_KEYS is set',
    );
  const keys = parseOperatorKeys(
    config.OPERATOR_API_KEYS,
    (text) => new Uint8Array(Buffer.from(text, 'base64url')),
  );
  const listener = await startOperatorListener({
    host,
    port: config.OPERATOR_PORT,
    resolve: async (name) => (await lookup(name, { family: 6 })).address,
    serve: ({ hostname, port, fetch }) =>
      Bun.serve({ hostname, port, fetch, maxRequestBodySize: 32 * 1024 }),
    handle: createOperatorApi({
      contentModeration: app.database,
      profilePhotos: app.profilePhotoObjects,
      audience,
      keys,
      nowMs: () => nowMs(app.clock),
      admitNonce: (input) => app.redis.admitOperatorNonce(input),
      store: app.database,
      nextId: () => app.ids.next(),
      logger: app.logger,
      reporter,
    }),
  });
  app.logger.log(
    'operator.listener.started',
    { operation: 'operator.listener', port: config.OPERATOR_PORT },
    'Operator API listening on the private network',
  );
  return listener;
}
