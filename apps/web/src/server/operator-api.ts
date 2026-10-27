import { lookup } from 'node:dns/promises';
import { parseOperatorKeys } from '@daisy/auth/operator-signature';
import { createOperatorApi } from '../features/operator-api/router';
import { startOperatorListener } from '../features/operator-api/listener';
import {
  decodeBase64url,
  nodeOperatorCrypto,
} from '../features/operator-api/node-crypto';
import type { ErrorReporter } from '@daisy/observability';
import type { App } from './app';

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
  const keys = parseOperatorKeys(config.OPERATOR_API_KEYS, decodeBase64url);
  const listener = await startOperatorListener({
    // The config schema requires both whenever keys are set.
    host: config.OPERATOR_LISTEN_HOST!,
    port: config.OPERATOR_PORT,
    resolve: async (name) => (await lookup(name, { family: 6 })).address,
    serve: ({ hostname, port, fetch }) =>
      Bun.serve({ hostname, port, fetch, maxRequestBodySize: 32 * 1024 }),
    handle: createOperatorApi({
      audience: config.OPERATOR_AUDIENCE!,
      keys,
      crypto: nodeOperatorCrypto,
      nowMs: () => Date.parse(app.clock.now()),
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
