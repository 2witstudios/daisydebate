import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { withFixture, withDatabase } from './constraint-helpers';
import { command, pendingAccount } from './operator-accounts.test-support';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

class Released extends Error {}

test('a PUT delayed past its signed deadline behind a lock writes nothing (ADR 0077, A1)', async () => {
  await withFixture(url, async (fixture) => {
    const { userId } = await pendingAccount(fixture);
    let expired = false;
    const input = command(userId, 'approved', 1, { live: () => !expired });
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    // Another session holds the command-id lock, so the PUT waits behind it.
    let held!: () => void;
    const holding = new Promise<void>((resolve) => (held = resolve));
    const holder = fixture.sql
      .begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${input.commandId}, 59079))`;
        held();
        await released;
        throw new Released();
      })
      .catch((error: unknown) => {
        if (!(error instanceof Released)) throw error;
      });
    await holding;
    await withDatabase(url, async (database) => {
      const put = database.runBetaAccessCommand(input);
      // The PUT is waiting on the lock; its deadline passes while it waits.
      for (;;) {
        const [waiting] =
          await fixture.sql`select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted`;
        if (waiting?.n === 1) break;
      }
      expired = true;
      release();
      await holder;
      await assertRejects({
        given: 'a beta access PUT that acquired its locks after its deadline',
        should: 'be refused',
        actual: () => put,
        code: 'CONFLICT',
      });
    });
    const [state] =
      await fixture.sql`select state, revision from account_beta_access where user_id = ${userId}`;
    const [written] = await fixture.sql`select
        (select count(*)::int from operator_command_receipts where command_id = ${input.commandId}) as receipts,
        (select count(*)::int from account_access_events where command_id = ${input.commandId}) as events,
        (select count(*)::int from mail_intents where recipient_user_id = ${userId}) as mail`;
    assert({
      given: 'the refused late PUT',
      should:
        'leave the account pending with no receipt, event or mail, so an abandon is true',
      actual: { state, written },
      expected: {
        state: { state: 'pending', revision: 1 },
        written: { receipts: 0, events: 0, mail: 0 },
      },
    });
  });
});
