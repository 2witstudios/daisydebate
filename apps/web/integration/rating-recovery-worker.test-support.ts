import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { createDatabase } from '@daisy/db';
import { createRatingSweep } from '../src/features/ratings/sweep';
const { databaseUrl } = requireTestServices(process.env);
if (!/_test_run_[a-f0-9]{8}$/.test(new URL(databaseUrl).pathname))
  throw new Error('Recovery worker requires isolated runner database');
const database = createDatabase({ url: databaseUrl, nextActorId: createId });
try {
  let failures = 0;
  const sweep = createRatingSweep({
    database,
    ids: { next: createId },
    onFailure: () => {
      failures++;
    },
  });
  const page = await sweep({ limit: 2 });
  process.stdout.write(JSON.stringify({ page, failures }));
} finally {
  await database.close();
}
