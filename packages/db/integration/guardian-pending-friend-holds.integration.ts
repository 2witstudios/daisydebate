import { hostWaits } from '@daisy/worker/host';
import { afterAll, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { finishedOrBlockedBehind } from '../src/testing';
import { Fixture } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

const { databaseUrl } = requireTestServices(process.env);
const races = [
  { name: 'two guardians tightening for one child', sameChild: true },
  { name: 'two children on one pending request', sameChild: false },
].map((race, index) => ({
  ...race,
  scratch: scratchDatabase(databaseUrl, `guardianpendingholds${index}`),
}));
const budgetScratch = scratchDatabase(databaseUrl, 'guardianholdbudget');
afterAll(async () => {
  await Promise.all([
    budgetScratch.drop(),
    ...races.map(({ scratch }) => scratch.drop()),
  ]);
});

async function recordAge(fixture: Fixture, userId: string, years: number) {
  await fixture.sql`insert into account_age(user_id, birth_month, version, recorded_at)
    values (${userId}, to_char(now() - make_interval(years => ${years}), 'YYYY-MM'), 1, now())`;
}

async function link(fixture: Fixture, guardianId: string, childId: string) {
  const at = new Date();
  const evidence = createId();
  await fixture.insert('guardian_consent_evidence', {
    id: evidence,
    person_user_id: guardianId,
    role: 'guardian',
    method: 'created-account',
    notice_kind: 'parental-consent',
    notice_version: 'fixture',
    notice_digest: 'a'.repeat(64),
    recorded_at: at,
  });
  await fixture.insert('guardian_links', {
    id: createId(),
    guardian_user_id: guardianId,
    minor_user_id: childId,
    guardian_consent_id: evidence,
    status: 'active',
    activation: 'created-account',
    activated_at: at,
    created_at: at,
  });
}

async function request(sql: SQL, requester: string, recipient: string) {
  const [low, high] = [requester, recipient].sort();
  await sql`insert into contact_pairs(low_actor_id, high_actor_id) values (${low}, ${high})`;
  await sql`insert into friendships(low_actor_id, high_actor_id, requester_actor_id, state, requested_at)
    values (${low}, ${high}, ${requester}, 'pending', now())`;
  return [low, high];
}

test.each(races)(
  'concurrent protection changes for $name both commit',
  async ({ scratch, sameChild }) => {
    await scratch.create();
    await scratch.migrate(() => true);
    const sql = new SQL(scratch.url);
    try {
      const fixture = new Fixture(sql);
      const at = new Date();
      const person = async () => {
        const userId = await fixture.user();
        const actorId = await fixture.actor(userId);
        return { userId, actorId };
      };
      const [firstGuardian, secondGuardian, firstChild, secondChild] = (
        await Promise.all([person(), person(), person(), person()])
      ).sort((left, right) => left.userId.localeCompare(right.userId));
      if (!firstGuardian || !secondGuardian || !firstChild || !secondChild)
        throw new Error('Missing family fixture');
      for (const [person, age] of [
        [firstGuardian, 40],
        [secondGuardian, 40],
        [firstChild, 15],
        [secondChild, 15],
      ] as const)
        await recordAge(fixture, person.userId, age);
      await link(fixture, firstGuardian.userId, firstChild.userId);
      await link(fixture, secondGuardian.userId, firstChild.userId);
      await link(fixture, secondGuardian.userId, secondChild.userId);
      const [low, high] = await request(
        sql,
        firstChild.actorId,
        secondChild.actorId,
      );

      const firstPlanned = Promise.withResolvers<number>();
      const finishFirst = Promise.withResolvers<void>();
      const setSupervised = (
        guardianId: string,
        childId: string,
        afterPlan?: (pid: number) => Promise<void>,
      ) =>
        sql.begin(async (tx) => {
          await tx`set local role daisy_web`;
          await tx`select set_config('daisy.subject_scope', ${guardianId}, true)`;
          const [plan] = await tx<{ slots: number; pid: number }[]>`select
            public.daisy_set_protection_level(${childId}, '{"level":"supervised"}', ${at}) as slots,
            pg_backend_pid() as pid`;
          if (!plan) throw new Error('Missing protection setter plan');
          await afterPlan?.(plan.pid);
          if (!plan.slots) return;
          const ids = Array.from({ length: plan.slots }, () => createId());
          await tx`select public.daisy_set_protection_level(${childId}, '{"level":"supervised"}',
            ${at}, ${sql.array(ids, 'text')}::text[])`;
        });
      const first = setSupervised(
        firstGuardian.userId,
        firstChild.userId,
        async (pid) => {
          firstPlanned.resolve(pid);
          await finishFirst.promise;
        },
      ).catch((error: unknown) => {
        firstPlanned.reject(error);
        throw error;
      });
      let second: Promise<void> | undefined;
      try {
        const pid = await firstPlanned.promise;
        second = setSupervised(
          secondGuardian.userId,
          (sameChild ? firstChild : secondChild).userId,
        );
        expect(
          await finishedOrBlockedBehind(second, sql, pid, { waits: hostWaits }),
        ).toBe('blocked');
      } finally {
        finishFirst.resolve();
        await Promise.all([first, second]);
      }

      expect<unknown>(
        await sql`select state from friendships where low_actor_id=${low} and high_actor_id=${high}`,
      ).toEqual([{ state: 'pending' }]);
      expect<unknown>(
        await sql`select child_actor_id from friend_guardian_approvals
          where low_actor_id=${low} and high_actor_id=${high} order by child_actor_id`,
      ).toEqual(
        (sameChild ? [firstChild.actorId] : [low, high]).map(
          (child_actor_id) => ({ child_actor_id }),
        ),
      );
      expect<unknown>(
        await sql`select user_id from notifications where kind='friend_guardian_approval'
          and friendship_low_actor_id=${low} and friendship_high_actor_id=${high} order by user_id`,
      ).toEqual(
        [firstGuardian.userId, secondGuardian.userId]
          .sort()
          .map((user_id) => ({ user_id })),
      );
    } finally {
      await sql.close();
    }
  },
  ddlTimeoutMs,
);

test(
  'the setter replans before writing when another pending request becomes covered',
  async () => {
    await budgetScratch.create();
    await budgetScratch.migrate(() => true);
    const sql = new SQL(budgetScratch.url);
    try {
      const fixture = new Fixture(sql);
      const guardian = await fixture.user();
      const child = await fixture.user();
      const adult = await fixture.user();
      const youngerSender = await fixture.user();
      await fixture.actor(guardian);
      const recipient = await fixture.actor(child);
      for (const [userId, years] of [
        [guardian, 40],
        [child, 15],
        [adult, 20],
        [youngerSender, 17],
      ] as const)
        await recordAge(fixture, userId, years);
      await link(fixture, guardian, child);
      await sql`insert into protection_levels(user_id, choice) values (${child}, '{"level":"independent"}')`;
      await request(sql, await fixture.actor(adult), recipient);
      await request(sql, await fixture.actor(youngerSender), recipient);
      await sql.begin(async (tx) => {
        await tx`set local role daisy_web`;
        await tx`select set_config('daisy.subject_scope', ${guardian}, true)`;
        const [planned] =
          await tx`select public.daisy_set_protection_level(${child}, '{"level":"guided"}') as slots`;
        expect(planned?.slots).toBe(2);

        // Make the second sender adult between the same two statements that can straddle an age boundary.
        await sql`update account_age set birth_month=to_char(now() - interval '20 years', 'YYYY-MM'),
          version=version + 1 where user_id=${youngerSender}`;
        const apply = (slots: number) =>
          tx`select public.daisy_set_protection_level(${child}, '{"level":"guided"}', statement_timestamp(),
            ${sql.array(
              Array.from({ length: slots }, () => createId()),
              'text',
            )}::text[]) as slots`;
        expect(await apply(2)).toEqual([{ slots: 4 }]);
        expect<unknown>(
          await tx`select public.daisy_protection_level(${child}) as choice`,
        ).toEqual([{ choice: { level: 'independent' } }]);
        expect(await apply(4)).toEqual([{ slots: 0 }]);
      });
      expect<unknown>(
        await sql`select count(*)::int as count from friend_guardian_approvals where child_actor_id=${recipient}`,
      ).toEqual([{ count: 2 }]);
      expect<unknown>(
        await sql`select count(*)::int as count from notifications where user_id=${guardian} and kind='friend_guardian_approval'`,
      ).toEqual([{ count: 2 }]);
    } finally {
      await sql.close();
    }
  },
  ddlTimeoutMs,
);
