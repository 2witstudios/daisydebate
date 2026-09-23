/**
 * `bun db:reset`: drops and re-migrates one of this checkout's own slot
 * databases (ADR 0034), then restores the daisy_e2e grants the browser suite
 * needs. Any other database, a non-loopback host, production, or a missing
 * ALLOW_DATABASE_RESET=yes is refused before a connection opens.
 */
import { SQL } from 'bun';
import { resolve } from 'node:path';
import { resetPublicSchema, withSlotLock } from '@daisy/db/slots';
import { e2eRole, resetRefusal } from './slot-model';
import { migrate, resolveCheckout } from './slot';

const root = resolve(import.meta.dir, '..');
const checkout = await resolveCheckout(root);
const { slot } = checkout;
const refusal = resetRefusal(slot, process.env);
if (refusal) throw new Error(refusal);
const url = process.env.DATABASE_URL ?? '';
// Re-running every migration recreates cluster-wide roles (0004), so reset
// takes the same slot lock as slot:up. Advisory locks are per database: every
// holder takes it from the `postgres` database, never the slot's own.
const adminUrl = new URL(url);
adminUrl.pathname = '/postgres';
const admin = new SQL(adminUrl.toString(), { max: 1 });
const client = new SQL(url, { max: 1 });
try {
  await withSlotLock(admin, async () => {
    await resetPublicSchema(client, e2eRole.user);
    await migrate(url, checkout.path);
  });
} finally {
  await client.close();
  await admin.close();
}
