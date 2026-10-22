import { fileURLToPath } from 'node:url';
import { requireTestSlotServices } from '@daisy/config';
import { TEST_RUN_MAX_MS } from '@daisy/redis/testing';
import { withRunDatabase } from './test-run-database';
const key = process.env.OPENROUTER_API_KEY;
if (!key)
  throw Error(
    'Configured OpenRouter capability is required for the actual capture worker proof',
  );
const services = requireTestSlotServices(process.env),
  root = fileURLToPath(new URL('../', import.meta.url));
await withRunDatabase({
  slotDatabaseUrl: services.databaseUrl,
  root,
  maxRunMs: TEST_RUN_MAX_MS,
  onSweep: () => {},
  work: async (run) => {
    process.env.TEST_DATABASE_URL = run.url;
    process.env.TEST_RUN_DATABASE = run.name;
    const { proveMediaWorker } = await import('./media-worker-proof');
    const { withRoomRuntime } =
      await import('../apps/web/integration/room-runtime.test-support');
    let original: unknown;
    try {
      await withRoomRuntime(async (f) => {
        try {
          await proveMediaWorker(f, key, root);
        } catch (error) {
          original = error;
          throw error;
        }
      });
    } catch (error) {
      throw original ?? error;
    }
  },
});
