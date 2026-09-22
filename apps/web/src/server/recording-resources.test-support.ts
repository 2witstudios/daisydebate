import { readServerConfig } from '@daisy/config';
import type { Logger } from '@daisy/logger';

type RecordedLog = { event: string; message: string; fields: unknown };

/**
 * Seeds process-local resources with a logger that records every call, so
 * tests of `handleOperation`-based handlers can assert on emitted log
 * fields without building real database or Redis clients. Call before
 * importing the module under test. Returns the live `recorded` array (clear
 * it between assertions with `recorded.length = 0`) and the seeded
 * `resources` object, for tests that need to restore it after mutating
 * `globalThis.daisyResources`.
 */
export function seedRecordingResources() {
  const recorded: RecordedLog[] = [];
  const createRecorder = (
    boundFields: Record<string, unknown> = {},
  ): Logger => ({
    log: (event, fields, message) =>
      recorded.push({ event, fields: { ...boundFields, ...fields }, message }),
    child: (fields) => createRecorder({ ...boundFields, ...fields }),
  });
  const resources = {
    config: readServerConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://unit:unit@localhost:5432/unit',
      REDIS_URL: 'redis://localhost:6379',
      REDIS_NAMESPACE: 'test',
      PUBLIC_APP_URL: 'http://localhost:3000',
      APP_VERSION: 'test',
      GIT_COMMIT: 'test',
    }),
    logger: createRecorder(),
    draining: false,
  };
  Reflect.set(globalThis, 'daisyResources', resources);
  return { recorded, resources };
}
