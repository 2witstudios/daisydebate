import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { withSeasons } from '@daisy/db/seasons';
import { ratingDivisions } from '@daisy/protocol';
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
      // Each official lobby's Season 1, through the fixture activation operation.
      for (const division of ratingDivisions)
        await seasons.activateBetaSeason({ id: createId(), division });
    },
    client,
  );
} finally {
  await client.close();
}
