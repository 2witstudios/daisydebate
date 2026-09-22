import { readServerConfig } from '@daisy/config';
import type { Logger } from '@daisy/logger';

/**
 * Seeds the process-local resources with a silent logger so unit tests of
 * `handleOperation`-based handlers never build real database or Redis
 * clients. Call before importing the module under test.
 */
export function seedSilentResources(publicAppUrl = 'https://daisy.invalid') {
  const silent: Logger = { log: () => {}, child: () => silent };
  Reflect.set(globalThis, 'daisyResources', {
    config: readServerConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://unit:unit@localhost:5432/unit',
      REDIS_URL: 'redis://localhost:6379',
      REDIS_NAMESPACE: 'test',
      PUBLIC_APP_URL: publicAppUrl,
      APP_VERSION: 'test',
      GIT_COMMIT: 'test',
    }),
    logger: silent,
    draining: false,
  });
}
