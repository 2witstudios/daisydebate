import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { createPasskeyFlows } from './auth-passkey-flows';
import { cookieHeader, emailOf, userIdOf, withSql } from './fixtures';
import { emailedLinkIdentifier } from '../src/features/auth/emailed-link-token';
import { requireTestServices } from '@daisy/config';

/**
 * ISSUE-99 (AUTH-5.6: revoke outstanding old-address auth links): a sign-in
 * link mailed to the old address before an email change completes must stop
 * working once the change completes. Before this, the completion only
 * switched the address, so the old link, redeemed afterwards, found no
 * account at the old address and signed up a brand-new one there.
 */
requireTestServices(process.env);
setupRitewayBun();

const flows = await createPasskeyFlows();
const { signUp } = flows.account;
const { linkTokenFor, redeem, userRows } = flows.account.flows;

const signInRow = (token: string) =>
  withSql(
    (sql) =>
      sql`SELECT 1 FROM verification WHERE identifier = ${emailedLinkIdentifier('sign-in', token)}`,
  ).then((rows) => rows.length);

describe('ISSUE-99 an email change revokes the old address sign-in links', () => {
  test('a sign-in link for the old address, redeemed after the change completes, creates no session and no account', async () => {
    const { email, cookie } = await signUp();
    const uid = (await userIdOf(email)) ?? '';
    const bystander = flows.account.flows.fresh();
    const oldAddressToken = await linkTokenFor(email);
    const bystanderToken = await linkTokenFor(bystander);
    const { newEmail, verifyToken } = await flows.confirmedEmailChange(cookie);

    const beforeCompletion = await signInRow(oldAddressToken);
    const completion = await flows.confirmEmailPost(verifyToken);
    const afterCompletion = await signInRow(oldAddressToken);
    const bystanderAfter = await signInRow(bystanderToken);
    const lateRedemption = await redeem(oldAddressToken);

    assert({
      given:
        'a sign-in link mailed to the old address before the email change completes, redeemed through the real confirm page afterwards',
      should:
        "delete its stored row in the completion, refuse it without a session, and leave no account at the old address, while another address's link survives",
      actual: {
        completionStatus: completion.status,
        emailAfter: await emailOf(uid),
        storedBeforeCompletion: beforeCompletion,
        storedAfterCompletion: afterCompletion,
        bystanderLinkKept: bystanderAfter,
        lateRedemption: lateRedemption.headers.get('location'),
        lateSession: cookieHeader(lateRedemption),
        accountsAtOldAddress: (await userRows(email)).length,
      },
      expected: {
        completionStatus: 303,
        emailAfter: newEmail,
        storedBeforeCompletion: 1,
        storedAfterCompletion: 0,
        bystanderLinkKept: 1,
        lateRedemption: '/auth/confirm?error=INVALID_TOKEN',
        lateSession: '',
        accountsAtOldAddress: 0,
      },
    });
  });

  test('the old-address links are deleted by the same transaction that switches the address', async () => {
    const { email, cookie } = await signUp();
    const uid = (await userIdOf(email)) ?? '';
    const oldAddressToken = await linkTokenFor(email);
    const { verifyToken } = await flows.confirmedEmailChange(cookie);

    // A fixture trigger fires on exactly this stored row's delete and
    // inserts a marker outbox row from inside the deleting transaction
    // (`outbox.txid` defaults to `pg_current_xact_id()`). The committed
    // account row's `xmin` is the transaction that switched its address, so
    // the two match only if the delete ran in that same transaction: moving
    // the delete onto another connection turns this red.
    const markerTopic = `test:link-revoke-marker:${createId()}`;
    const fnName = `link_revoke_marker_${createId()}`;
    const identifier = emailedLinkIdentifier('sign-in', oldAddressToken);
    await withSql((sql) =>
      sql.unsafe(`
        create function "${fnName}"() returns trigger as $body$
        begin
          if old.identifier = '${identifier}' then
            insert into outbox (topic, kind, version, payload)
            values ('${markerTopic}', 'test.link_revoke_marker', 1, '{}'::jsonb);
          end if;
          return old;
        end;
        $body$ language plpgsql
      `),
    );
    await withSql((sql) =>
      sql.unsafe(`
        create trigger "${fnName}_trigger" before delete on verification
        for each row execute function "${fnName}"()
      `),
    );
    let completion: Response;
    try {
      completion = await flows.confirmEmailPost(verifyToken);
    } finally {
      await withSql((sql) =>
        sql.unsafe(
          `drop trigger if exists "${fnName}_trigger" on verification`,
        ),
      );
      await withSql((sql) =>
        sql.unsafe(`drop function if exists "${fnName}"()`),
      );
    }
    // xmin is a 32-bit xid; the marker's xid8 carries the epoch above it.
    const [marker] = await withSql(
      (sql) =>
        sql`SELECT (txid::text::numeric % 4294967296)::text AS xid FROM outbox WHERE topic = ${markerTopic}`,
    );
    const [account] = await withSql(
      (sql) => sql`SELECT xmin::text AS xid FROM users WHERE id = ${uid}`,
    );
    await withSql(
      (sql) => sql`DELETE FROM outbox WHERE topic = ${markerTopic}`,
    );

    assert({
      given:
        'an email-change completion and a fixture trigger that marks the transaction deleting the old-address sign-in link',
      should:
        "complete, and delete the link in the very transaction that committed the account's new address",
      actual: {
        completionStatus: completion.status,
        linkDeleted: marker !== undefined,
        sameTransaction: marker?.xid === account?.xid,
      },
      expected: {
        completionStatus: 303,
        linkDeleted: true,
        sameTransaction: true,
      },
    });
  });
});
