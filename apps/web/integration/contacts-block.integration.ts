import {
  blockDependencies,
  openMessagingFixture,
} from './messaging-fixture.test-support';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assertRejects } from '@daisy/errors/testing';
import { blockContact } from '../src/features/contacts/block';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('same-transaction participant safety controls require no age or posting policy', async () => {
  const {
    client: sql,
    database: database,
    fixture,
    principal,
  } = await openMessagingFixture(databaseUrl);
  const dependencies = blockDependencies({ database, fixture }, principal);
  const command = {
    version: 1,
    requestId: createId(),
    otherActorId: fixture.otherActorId,
    blocked: true,
  };
  try {
    await sql.unsafe('delete from account_age where user_id in ($1,$2)', [
      fixture.userId,
      fixture.otherUserId,
    ]);
    const choices = await Promise.all([
      blockContact(command, principal, dependencies),
      blockContact(command, principal, dependencies),
    ]);
    const [durable] = await sql.unsafe(
      `select revision::int,(select count(*)::int from contact_commands where actor_id=$1) as receipts,(select count(*)::int from outbox where payload->>'channelId'=$2) as bells from contact_pairs where low_actor_id=$3 and high_actor_id=$4`,
      [fixture.actorId, fixture.channelId, fixture.low, fixture.high],
    );
    assert({
      given: 'current member without age facts or a posting policy',
      should:
        'serialize equal safety retries into one durable choice; the channel needs no doorbell, its authority revision reaches observers (ADR 0089)',
      actual: { choices, durable },
      expected: {
        choices: [
          { blocked: true, revision: 2 },
          { blocked: true, revision: 2 },
        ],
        durable: { revision: 2, receipts: 1, bells: 0 },
      },
    });
    await assertRejects({
      given: 'a changed choice under a consumed request',
      should: 'refuse conflicting safety retry',
      actual: () =>
        blockContact({ ...command, blocked: false }, principal, dependencies),
      code: 'CONFLICT',
    });
    const unblocked = await blockContact(
      { ...command, requestId: createId(), blocked: false },
      principal,
      dependencies,
    );
    assert({
      given: 'a distinct explicit unblock choice',
      should: 'advance the contact revision without admission inference',
      actual: unblocked,
      expected: { blocked: false, revision: 3 },
    });
    await fixture.eraseSubject(fixture.actorId);
    await assertRejects({
      given: 'an erased caller retrying an accepted block request',
      should: 'refuse before reading the receipt or reintroducing authority',
      actual: () => blockContact(command, principal, dependencies),
      code: 'AUTHORIZATION',
    });
  } finally {
    await fixture.cleanup();
    await database.close();
    await sql.close();
  }
});
