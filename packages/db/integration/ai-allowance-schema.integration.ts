import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { rejectedBy, withFixture, type Fixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

const allowanceGrant =
  (fixture: Fixture, actorId: string) =>
  (id: string, start: number, end: number) =>
    fixture.sql.unsafe(
      'insert into ai_allowance_grants(id,actor_id,period_start,period_end) values($1,$2,$3,$4)',
      [id, actorId, new Date(start), new Date(end)],
    );

test('authoritative allowance periods cannot overlap and reservation timestamps preserve accounting truth', async () => {
  await withFixture(url, async (fixture) => {
    const actorId = await fixture.actor();
    const roundId = await fixture.round();
    const grantId = createId();
    try {
      const grant = allowanceGrant(fixture, actorId);
      await grant(grantId, 1000, 2000);
      assert({
        given: 'overlapping active authoritative allowance periods',
        should: 'refuse ambiguity',
        actual: await rejectedBy(() => grant(createId(), 1500, 2500)),
        expected: 'ai_allowance_grants_no_overlap',
      });
      await grant(createId(), 2000, 3000);
      await fixture.sql.unsafe(
        'update ai_allowance_grants set revoked_at=clock_timestamp() where id=$1',
        [grantId],
      );
      await grant(createId(), 1000, 2000);
      assert({
        given: 'an empty entitlement period',
        should: 'refuse invalid authority',
        actual: await rejectedBy(() => grant(createId(), 4000, 4000)),
        expected: 'ai_allowance_grants_period_check',
      });
      const reservationId = createId();
      await fixture.insert('usage_reservations', {
        id: reservationId,
        actor_id: actorId,
        round_id: roundId,
        kind: 'ai_practice',
      });
      const [created] = await fixture.sql.unsafe(
        'select reserved_at is not null as reserved,counted_at is null as uncalled,refunded_at is null as not_refunded from usage_reservations where id=$1',
        [reservationId],
      );
      assert({
        given: 'a new uncalled reservation',
        should: 'record PG admission time without inventing a call or refund',
        actual: created,
        expected: { reserved: true, uncalled: true, not_refunded: true },
      });
      assert({
        given: 'a refund without any vendor call',
        should: 'refuse conflating refund with never called',
        actual: await rejectedBy(() =>
          fixture.sql.unsafe(
            'update usage_reservations set refunded_at=clock_timestamp() where id=$1',
            [reservationId],
          ),
        ),
        expected: 'usage_reservations_refund_check',
      });
      await fixture.sql.unsafe(
        'update usage_reservations set counted_at=clock_timestamp() where id=$1',
        [reservationId],
      );
      await fixture.sql.unsafe(
        'update usage_reservations set refunded_at=clock_timestamp() where id=$1',
        [reservationId],
      );
      const otherRound = await fixture.round();
      assert({
        given: 'a reservation with unknown admission time',
        should: 'refuse it rather than store or invent provenance',
        actual: await rejectedBy(() =>
          fixture.insert('usage_reservations', {
            id: createId(),
            actor_id: actorId,
            round_id: otherRound,
            kind: 'ai_practice',
            reserved_at: null,
          }),
        ),
        expected: '23502',
      });
    } finally {
      const [table] =
        await fixture.sql`select to_regclass('public.ai_allowance_grants') as name`;
      if (table?.name)
        await fixture.sql.unsafe(
          'delete from ai_allowance_grants where actor_id=$1',
          [actorId],
        );
    }
  });
});
