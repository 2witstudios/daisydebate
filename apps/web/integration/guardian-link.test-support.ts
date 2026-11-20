import type { SQL, TransactionSQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';

export async function seedGuardianLink(
  sql: SQL | TransactionSQL,
  parent: string,
  child: string,
) {
  const consentId = createId();
  await sql`insert into guardian_consent_evidence
    (id, person_user_id, role, method, notice_kind, notice_version, notice_digest, recorded_at)
    values (${consentId}, ${parent}, 'guardian', 'created-account', 'parental-consent', 'fixture', repeat('0', 64), now())`;
  await sql`insert into guardian_links
    (id, guardian_user_id, minor_user_id, guardian_consent_id, status, activation, activated_at)
    values (${createId()}, ${parent}, ${child}, ${consentId}, 'active', 'created-account', now())`;
}
