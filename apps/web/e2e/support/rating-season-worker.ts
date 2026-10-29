import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { withSeasons } from '@daisy/db/seasons';
import { betaAccessTarget } from './beta-access-target';
// Same isolated e2e role/database boundary as beta approval; never deploy data.
const url = betaAccessTarget(process.env);
const client = new SQL(url, { max: 1 });
try {
  const [identity] = await client`select current_user as role`;
  if (identity?.role !== 'daisy_e2e')
    throw new Error('Rating proof identity refused');
  await withSeasons(
    url,
    async (seasons) => {
      await seasons.activateBetaSeason({ id: createId() });
    },
    client,
  );
} finally {
  await client.close();
}
