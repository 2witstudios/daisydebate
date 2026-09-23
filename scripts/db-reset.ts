/**
 * `bun db:reset`: drops and re-migrates one of this checkout's own slot
 * databases (ADR 0034), then restores the daisy_e2e grants the browser suite
 * needs. Any other database, a non-loopback host, production, or a missing
 * ALLOW_DATABASE_RESET=yes is refused before a connection opens.
 */
import { SQL } from 'bun';
import { resolve } from 'node:path';
import { resetPublicSchema } from '@daisy/db/slots';
import { e2eRole, resetRefusal } from './slot-model';
import { migrate, resolveCheckout } from './slot';

const root = resolve(import.meta.dir, '..');
const checkout = await resolveCheckout(root);
const { slot } = checkout;
const refusal = resetRefusal(slot, process.env);
if (refusal) throw new Error(refusal);
const client = new SQL(process.env.DATABASE_URL ?? '', { max: 1 });
try {
  await resetPublicSchema(client, e2eRole.user);
} finally {
  await client.close();
}
await migrate(process.env.DATABASE_URL ?? '', checkout.path);
