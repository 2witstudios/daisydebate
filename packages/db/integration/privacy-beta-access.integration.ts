import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  betaAccessPrivacyAdopter,
  betaAccessPrivacyExpectedColumns,
  erasePrivacySubject,
  exportPrivacySubject,
} from '../src/privacy';
import { bindings, now, withPrivacySubject } from './privacy.test-support';

setupRitewayBun();
requireTestServices(process.env);

const adoption = {
  requiredAdopters: [
    {
      id: betaAccessPrivacyAdopter.id,
      phase: betaAccessPrivacyAdopter.phase,
      expectedColumns: betaAccessPrivacyExpectedColumns,
    },
  ],
  adopters: [betaAccessPrivacyAdopter],
};

test('erasure removes beta state and owed mail; export carries the beta fields', async () => {
  await withPrivacySubject(async ({ client, database, userId, actorId }) => {
    await client.unsafe(
      `insert into account_beta_access (user_id, state, revision, requested_at, decided_at, provenance)
       values ($1, 'approved', 2, timestamptz '2026-10-01 00:00:00+00', timestamptz '2026-10-02 00:00:00+00', 'signup')`,
      [userId],
    );
    const eventId = createId();
    await client.unsafe(
      `insert into account_access_events (id, user_id, to_state, revision, principal)
       values ($1, $2, 'approved', 2, 'signup')`,
      [eventId, userId],
    );
    await client.unsafe(
      `insert into mail_intents (id, purpose, recipient_user_id, dedupe_key, next_attempt_at)
       values ($1, 'beta-approved', $2, $3, now())`,
      [createId(), userId, `beta-approved:${createId()}`],
    );
    const exported = await exportPrivacySubject(
      database,
      { userId, actorId },
      adoption,
    );
    await erasePrivacySubject(
      database,
      { subject: { userId, actorId }, now, vendors: [], jobIds: [] },
      adoption,
      bindings,
    );
    const count = async (table: string, column: string) =>
      (
        (await client.unsafe(
          `select count(*)::int as c from ${table} where ${column} = $1`,
          [userId],
        )) as Array<{ c: number }>
      )[0]!.c;
    assert({
      given:
        'an approved account with an audit event and an owed approval email',
      should:
        'export its beta row, then erase the row and the mail and keep the audit against the tombstone',
      actual: {
        exported: exported.account_beta_access,
        access: await count('account_beta_access', 'user_id'),
        mail: await count('mail_intents', 'recipient_user_id'),
        audit: await count('account_access_events', 'user_id'),
      },
      expected: {
        exported: [
          {
            user_id: userId,
            state: 'approved',
            revision: 2,
            requested_at: '2026-10-01T00:00:00.000Z',
            decided_at: '2026-10-02T00:00:00.000Z',
            provenance: 'signup',
          },
        ],
        access: 0,
        mail: 0,
        audit: 1,
      },
    });
  });
});
