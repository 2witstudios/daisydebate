import { readMediaWorkerConfig } from '@daisy/config';
import { createMediaWorkerDatabase } from '@daisy/db/media-worker';

// The deploy hold's reading, run on the worker machine (scripts/capture-deploy-hold.ts).
// A number and nothing else: no round, session or person.
const config = readMediaWorkerConfig(process.env);
const database = createMediaWorkerDatabase({
  url: config.MEDIA_WORKER_DATABASE_URL,
});
try {
  process.stdout.write(`${await database.countLiveCaptures()}\n`);
} finally {
  await database.close();
}
