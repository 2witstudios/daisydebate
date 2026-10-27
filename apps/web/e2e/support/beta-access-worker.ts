import { SQL } from 'bun';
import { z } from 'zod';
import { approveBetaAccess } from '@daisy/db/testing';
import { betaAccessTarget } from './beta-access-target';

/**
 * Approves browser-suite accounts for the beta (ADR 0075), as an operator
 * would, on the e2e database as its loopback `daisy_e2e` login only.
 */
const emails = z
  .strictObject({ emails: z.array(z.email()).min(1).max(20) })
  .parse(JSON.parse(await Bun.stdin.text())).emails;
const url = betaAccessTarget(process.env);
const client = new SQL(url, { max: 1 });
try {
  const [identity] =
    await client`select current_database() as database, current_user as role`;
  if (
    identity?.database !== new URL(url).pathname.slice(1) ||
    identity?.role !== 'daisy_e2e'
  )
    throw new Error('Beta access connection identity refused');
  for (const email of emails) {
    const [row] =
      (await client`select id from users where email = ${email}`) as {
        id: string;
      }[];
    if (!row) throw new Error('No account for that address');
    await approveBetaAccess(client, row.id);
  }
  process.stdout.write(JSON.stringify({ approved: emails.length }));
} finally {
  await client.close();
}
