import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { loadAuthorizationAgeFact } from '../src/account-age';
import { withFixture, sqlStateOf } from './constraint-helpers';
import { createAuthorizationSubject } from './authorization.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('realtime age producer exposes monthly bands under the canonical erasure fence without source access', async () => {
  await withFixture(databaseUrl, async (fixture) => {
    const { userId, actorId } = await createAuthorizationSubject(fixture);
    const now = '2026-10-09T00:00:00.000Z';
    const cases = [
      ['2013-11', 'under-13'],
      ['2013-10', '13-15'],
      ['2010-11', '13-15'],
      ['2010-10', '16-17'],
      ['2008-11', '16-17'],
      ['2008-10', 'adult'],
      ['2026-11', null],
    ] as const;
    const actual: unknown[] = [];
    try {
      for (const [birthMonth] of cases) {
        await fixture.sql`insert into account_age(user_id,birth_month,version,recorded_at)
          values(${userId},${birthMonth},1,'2026-09-01T00:00:00Z') on conflict(user_id)
          do update set birth_month=excluded.birth_month`;
        await fixture.sql.begin(async (client) => {
          await client`set local role daisy_realtime`;
          await client`create temporary table account_age(birth_month text) on commit drop`;
          const fact = await loadAuthorizationAgeFact(drizzle({ client }), {
            userId,
            actorId,
            accountRevision: 1,
            now,
          });
          actual.push(
            fact.state === 'known'
              ? [fact.band, fact.validUntil, Object.keys(fact).sort()]
              : null,
          );
        });
      }
      assert({
        given: 'birth-month boundaries and an untrusted temporary schema',
        should:
          'emit only canonical minimal bands with the next UTC month deadline',
        actual,
        expected: cases.map(([, band]) =>
          band
            ? [
                band,
                '2026-11-01T00:00:00.000Z',
                [
                  'accountRevision',
                  'actorId',
                  'band',
                  'revision',
                  'state',
                  'validUntil',
                ],
              ]
            : null,
        ),
      });
      await fixture.sql`update account_age set birth_month='2000-01',recorded_at='-infinity' where user_id=${userId}`;
      await fixture.sql.begin(async (client) => {
        await client`set local role daisy_realtime`;
        assert({
          given: 'a nonfinite persisted recording timestamp',
          should: 'match the pure age projector refusal',
          actual: await loadAuthorizationAgeFact(drizzle({ client }), {
            userId,
            actorId,
            accountRevision: 1,
            now,
          }),
          expected: { state: 'unknown' },
        });
      });
      // Historical producer negative control is transactional in this isolated test database.
      // No migration files, grant statements or durable function state are changed.
      const migration18 = await Bun.file(
        new URL(
          '../migrations/20261009195939_canonical_minimal_authorization_age/migration.sql',
          import.meta.url,
        ),
      ).text();
      const oldFunction = migration18
        .split('--> statement-breakpoint')[0]!
        .replace(
          'CREATE FUNCTION public.daisy_authorization_age(',
          'CREATE OR REPLACE FUNCTION public.daisy_authorization_age(',
        );
      const rollbackControl = new Error('ROLLBACK_AGE_SOURCE_NEGATIVE_CONTROL');
      try {
        await fixture.sql.begin(async (client) => {
          await client.unsafe(oldFunction);
          await client`set local role daisy_realtime`;
          const oldFact = await loadAuthorizationAgeFact(drizzle({ client }), {
            userId,
            actorId,
            accountRevision: 1,
            now,
          });
          assert({
            given:
              'the immutable migration18 body with a nonfinite source timestamp',
            should:
              'reproduce the prior known-band defect as a negative control',
            actual: oldFact.state === 'known' ? oldFact.band : oldFact.state,
            expected: 'adult',
          });
          throw rollbackControl;
        });
      } catch (error) {
        if (error !== rollbackControl) throw error;
      }
      await fixture.sql.begin(async (client) => {
        await client`set local role daisy_realtime`;
        assert({
          given:
            'the forward19 producer restored after negative-control rollback',
          should:
            'still refuse the same nonfinite source without durable DDL changes',
          actual: await loadAuthorizationAgeFact(drizzle({ client }), {
            userId,
            actorId,
            accountRevision: 1,
            now,
          }),
          expected: { state: 'unknown' },
        });
      });
      await fixture.sql`update account_age set recorded_at='2026-09-01T00:00:00Z' where user_id=${userId}`;
      await fixture.sql.begin(async (client) => {
        await client`set local role daisy_realtime`;
        await loadAuthorizationAgeFact(drizzle({ client }), {
          userId,
          actorId,
          accountRevision: 1,
          now,
        });
        assert({
          given: 'the minimal age reader',
          should: 'hold the same account erasure fence',
          actual: await sqlStateOf(() =>
            fixture.sql.begin(
              (other) =>
                other`select id from public.users where id=${userId} for update nowait`,
            ),
          ),
          expected: '55P03',
        });
      });
      assert({
        given: 'the realtime role',
        should: 'have no raw birthmonth table access',
        actual: await sqlStateOf(() =>
          fixture.sql.begin(async (client) => {
            await client`set local role daisy_realtime`;
            await client`select birth_month from public.account_age where user_id=${userId}`;
          }),
        ),
        expected: '42501',
      });
      await fixture.sql`update users set deleted_at='2026-10-09T00:00:00Z',email_verified=false,username=null,version=2 where id=${userId}`;
      await fixture.sql.begin(async (client) => {
        await client`set local role daisy_realtime`;
        assert({
          given: 'a freshly erased account',
          should: 'refuse both prior and current revision age grants',
          actual: await Promise.all(
            [1, 2].map((accountRevision) =>
              loadAuthorizationAgeFact(drizzle({ client }), {
                userId,
                actorId,
                accountRevision,
                now,
              }),
            ),
          ),
          expected: [{ state: 'unknown' }, { state: 'unknown' }],
        });
      });
    } finally {
      await fixture.sql`delete from account_age where user_id=${userId}`;
    }
  });
});
