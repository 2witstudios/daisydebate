import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { withBeta } from './preapproval.test-support';
import { withClub } from './club-manager.test-support';
import { mailWorker } from './mail-delivery.test-support';

setupRitewayBun();

test('the actual worker uses each digest window and preserves cancellation precedence', async () => {
  await withBeta(async ({ sql, db, account }) => {
    const person = await account();
    await sql`update account_beta_access set requested_at='2001-02-03T04:15:00Z' where user_id=${person.userId}`;
    const ids = [createId(), createId(), createId()];
    try {
      for (const [index, id] of ids.entries()) {
        const window =
          index === 0 ? '2001-02-03T05:00:00Z' : '2001-02-03T04:10:00Z';
        await sql`insert into mail_intents(id,purpose,dedupe_key,window_start,next_attempt_at)
          values(${id},'beta-requests-digest',${`test:${id}`},${window},'2000-01-01')`;
        const app = mailWorker(
          db,
          index === 2 ? 'owner@example.test' : undefined,
        );
        await app.run(50);
        await app.run(50);
        const [row] =
          await sql`select state,last_error_code,window_start from mail_intents where id=${id}`;
        assert({
          given:
            'empty or populated immutable digest window with absent or configured owner address',
          should:
            'cancel empty as not-owed first, cancel unconfigured populated, or send once under the intent key without moving the window',
          actual: {
            sends: app.sent,
            keys: app.keys,
            failed: app.failed.length,
            state: row!.state,
            error: row!.last_error_code,
            window: (row!.window_start as Date).toISOString(),
          },
          expected: {
            sends: index === 2 ? [['owner@example.test']] : [],
            keys: index === 2 ? [id] : [],
            failed: 0,
            state: index === 2 ? 'sent' : 'cancelled',
            error:
              index === 0 ? 'not-owed' : index === 1 ? 'unconfigured' : null,
            window: new Date(window).toISOString(),
          },
        });
      }
    } finally {
      for (const id of ids) await sql`delete from mail_intents where id=${id}`;
    }
  });
});

test('the actual worker sends only open unexpired scoped Club invitations', async () => {
  await withClub(async ({ sql, database, organizationId, post }) => {
    for (const scenario of [
      'open',
      'closed',
      'expired',
      'foreign-key',
      'malformed-key',
      'mismatched-id',
      'deleted',
    ] as const) {
      await sql`update organizations set closed_at=null where id=${organizationId}`;
      const email = `${createId()}@example.test`;
      await post({ kind: 'invite', email });
      const [invitation] =
        await sql`select id from club_seat_invitations where organization_id=${organizationId} and email=${email}`;
      const invitationId = invitation!.id as string;
      const [intent] =
        await sql`select id from mail_intents where club_seat_invitation_id=${invitationId}`;
      const id = intent!.id as string;
      if (scenario === 'closed')
        await sql`update organizations set closed_at=now() where id=${organizationId}`;
      if (scenario === 'expired')
        await sql`update club_seat_invitations set expires_at=now()-interval '1 microsecond' where id=${invitationId}`;
      if (scenario === 'foreign-key')
        await sql`update mail_intents set dedupe_key=${`club-seat-invitation:${createId()}:${invitationId}:${createId()}`} where id=${id}`;
      if (scenario === 'malformed-key')
        await sql`update mail_intents set dedupe_key=${`test:${id}`} where id=${id}`;
      if (scenario === 'mismatched-id')
        await sql`update mail_intents set dedupe_key=${`club-seat-invitation:${organizationId}:${createId()}:${createId()}`} where id=${id}`;
      if (scenario === 'deleted') {
        // Persisted cancellation is required before the FK can be cleared.
        await sql`update mail_intents set state='cancelled',last_error_code='not-owed',completed_at=now() where id=${id}`;
        await sql`delete from club_seat_invitations where id=${invitationId}`;
      }
      assert({
        given:
          'a Club intent before a worker leases it (or after terminal cancellation)',
        should: 'refuse delivery at the storage lease gate',
        actual: await database.readMailIntentDelivery(id),
        expected: { kind: 'not-owed' },
      });
      const app = mailWorker(database);
      await app.run(50);
      await app.run(50);
      const [row] =
        await sql`select state,last_error_code,completed_at is not null as completed from mail_intents where id=${id}`;
      assert({
        given: `a ${scenario} Club invitation with a real leased queue and scoped delivery read`,
        should:
          'send only the open current invitation once under its intent key, otherwise persist not-owed without provider I/O',
        actual: {
          sends: app.sent,
          keys: app.keys,
          failed: app.failed.length,
          row,
        },
        expected: {
          sends: scenario === 'open' ? [[email]] : [],
          keys: scenario === 'open' ? [id] : [],
          failed: 0,
          row: {
            state: scenario === 'open' ? 'sent' : 'cancelled',
            last_error_code: scenario === 'open' ? null : 'not-owed',
            completed: true,
          },
        },
      });
      // Release the fixture's invitation capacity for the next scenario.
      await sql`delete from mail_intents where id=${id}`;
      await sql`delete from club_seat_invitations where id=${invitationId}`;
    }
  });
});
