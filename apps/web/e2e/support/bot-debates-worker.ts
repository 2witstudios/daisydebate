import { hostWaits } from '@daisy/worker/host';
import { createId } from '@paralleldrive/cuid2';
import { SQL } from 'bun';
import { z } from 'zod';
import { createDatabase } from '@daisy/db';
import { grantReleaseOverride } from '../../src/features/operator-api/flag-override.test-support';
import { betaAccessTarget } from './beta-access-target';

/**
 * Opens bot debates (`bot-debates`, ADR 0921) for browser-suite accounts the
 * way an operator does for a real one: an account override through the
 * operator flag command, on the e2e database as its loopback `daisy_e2e`
 * login only.
 */
const emails = z
  .strictObject({ emails: z.array(z.email()).min(1).max(20) })
  .parse(JSON.parse(await Bun.stdin.text())).emails;
const url = betaAccessTarget(process.env);
const client = new SQL(url, { max: 1 });
const database = createDatabase({
  waits: hostWaits,
  url,
  nextActorId: createId,
});
try {
  const [identity] =
    await client`select current_database() as database, current_user as role`;
  if (
    identity?.database !== new URL(url).pathname.slice(1) ||
    identity?.role !== 'daisy_e2e'
  )
    throw new Error('Bot debates connection identity refused');
  for (const email of emails) {
    const [row] =
      (await client`select id from users where email = ${email}`) as {
        id: string;
      }[];
    if (!row) throw new Error('No account for that address');
    await grantReleaseOverride({
      store: database,
      key: 'bot-debates',
      userId: row.id,
      nextId: createId,
    });
  }
  process.stdout.write(JSON.stringify({ released: emails.length }));
} finally {
  await database.close();
  await client.close();
}
