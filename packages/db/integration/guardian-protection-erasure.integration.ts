import { afterAll, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { sql as statement } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import { guardianLinksPrivacyAdopter } from '../src/guardians/privacy';
import { finishedOrBlockedBehind } from '../src/testing';
import { Fixture } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

const { databaseUrl } = requireTestServices(process.env);
// Consent evidence is immutable, so the committed race fixtures need a disposable database.
const scratch = scratchDatabase(databaseUrl, 'guardianprotection');
afterAll(() => scratch.drop());

test(
  'concurrent guardian erasures clear the child’s stored choice when their last links end',
  async () => {
    await scratch.create();
    await scratch.migrate(() => true);
    const sql = new SQL(scratch.url);
    try {
      const fixture = new Fixture(sql);
      const child = await fixture.user();
      const now = new Date().toISOString();
      const age = (id: string, years: string) =>
        sql`insert into account_age(user_id, birth_month, version, recorded_at)
          values (${id}, to_char(now() - ${years}::interval, 'YYYY-MM'), 1, ${now})`;
      await age(child, '15 years');
      const guardian = async () => {
        const userId = await fixture.user();
        const actorId = await fixture.actor(userId);
        await age(userId, '40 years');
        const evidence = createId();
        await fixture.insert('guardian_consent_evidence', {
          id: evidence,
          person_user_id: userId,
          role: 'guardian',
          method: 'created-account',
          notice_kind: 'parental-consent',
          notice_version: 'fixture',
          notice_digest: 'a'.repeat(64),
          recorded_at: now,
        });
        await fixture.insert('guardian_links', {
          id: createId(),
          guardian_user_id: userId,
          minor_user_id: child,
          guardian_consent_id: evidence,
          status: 'active',
          activation: 'created-account',
          activated_at: now,
          created_at: now,
        });
        return { userId, actorId };
      };
      const first = await guardian();
      const second = await guardian();
      await sql`insert into protection_levels(user_id, choice)
        values (${child}, '{"level":"supervised"}'::jsonb)`;

      const db = drizzle({ client: sql });
      const erased = Promise.withResolvers<number>();
      const release = Promise.withResolvers<void>();
      const close = (
        subject: typeof first,
        afterErase?: (pid: number) => Promise<void>,
      ) =>
        db.transaction(async (tx) => {
          await tx.execute(statement`set local role daisy_web`);
          await tx.execute(
            statement`update users set deleted_at=${now} where id=${subject.userId}`,
          );
          await guardianLinksPrivacyAdopter.erase(tx, subject, { now });
          if (afterErase) {
            const [row] = await tx.execute(
              statement`select pg_backend_pid() as pid`,
            );
            await afterErase(Number(row?.pid));
          }
        });
      const firstClose = close(first, async (pid) => {
        erased.resolve(pid);
        await release.promise;
      }).catch((error: unknown) => {
        erased.reject(error);
        throw error;
      });
      let secondClose: Promise<void> | undefined;
      try {
        const pid = await erased.promise;
        secondClose = close(second);
        await finishedOrBlockedBehind(secondClose, sql, pid, { now: Date.now });
      } finally {
        release.resolve();
        await Promise.all([firstClose, secondClose]);
      }
      expect(
        await sql<
          { status: string }[]
        >`select status from guardian_links where minor_user_id=${child} order by id`,
      ).toEqual([{ status: 'ended' }, { status: 'ended' }]);
      expect(
        await sql<
          { choice: unknown }[]
        >`select choice from protection_levels where user_id=${child}`,
      ).toEqual([]);
      await guardian();
      const [choice] = await db.transaction(async (tx) => {
        await tx.execute(statement`set local role daisy_web`);
        await tx.execute(
          statement`select set_config('daisy.subject_scope', ${child}, true)`,
        );
        return tx.execute(
          statement`select public.daisy_protection_level(${child}) as choice`,
        );
      });
      expect(choice?.choice).toEqual({ level: 'guided' });
    } finally {
      await sql.close();
    }
  },
  ddlTimeoutMs,
);
