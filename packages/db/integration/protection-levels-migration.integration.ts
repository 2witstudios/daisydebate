import { afterAll, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { createId } from '@paralleldrive/cuid2';
import { protectionLimits } from '@daisy/protocol/protection-level';
import {
  dmRequestPolicyRows,
  protectionChoices,
} from '../scripts/protection-policy-sql';
import { requireTestServices } from '@daisy/config';
import { withFixture } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

const { databaseUrl } = requireTestServices(process.env);
const scratch = scratchDatabase(databaseUrl, 'protection');
const folders = readdirSync(new URL('../migrations/', import.meta.url));
const migration = folders.find((folder) =>
  folder.endsWith('_pc_2_protection_levels'),
);
const validation = folders.find((folder) =>
  folder.endsWith('_pc_2_protection_checks_validated'),
);
if (!migration || !validation)
  throw new Error('Protection migrations are missing');
afterAll(() => scratch.drop());

test('the DM projection installs the canonical request rule', () => {
  const source = readFileSync(
    new URL(`../migrations/${migration}/migration.sql`, import.meta.url),
    'utf8',
  );
  expect(source).toContain(
    `VALUES\n    ${dmRequestPolicyRows()}\n  ), instant`,
  );
});

test(
  'the protection migration preserves an existing friendship, request and notification preference',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < migration);
    await withFixture(scratch.url, async (f) => {
      const recipientUser = await f.user();
      const recipient = await f.actor(recipientUser);
      const requester = await f.actor();
      const friend = await f.actor();
      try {
        const requestedAt = new Date();
        const guardian = createId();
        const linkedChild = createId();
        for (const [person, years] of [
          [guardian, '40 years'],
          [linkedChild, '15 years'],
        ] as const) {
          await f.sql`insert into users(id, username) values(${person}, ${`u-${person}`})`;
          await f.sql`insert into account_age(user_id,birth_month,version,recorded_at)
            values(${person},to_char(now() - ${years}::interval,'YYYY-MM'),1,${requestedAt})`;
        }
        // The existing PC-1 evidence stays immutable in this scratch database.
        const evidence = createId();
        await f.sql`insert into guardian_consent_evidence(id,person_user_id,role,method,notice_kind,notice_version,notice_digest,recorded_at)
          values(${evidence},${guardian},'guardian','created-account','parental-consent','fixture',${'a'.repeat(64)},${requestedAt})`;
        const link = createId();
        await f.sql`insert into guardian_links(id,guardian_user_id,minor_user_id,guardian_consent_id,status,activation,activated_at,created_at)
          values(${link},${guardian},${linkedChild},${evidence},'active','created-account',${requestedAt},${requestedAt})`;
        for (const [counterpart, state] of [
          [requester, 'pending'],
          [friend, 'accepted'],
        ] as const) {
          const [low, high] = [recipient, counterpart].sort();
          await f.sql`insert into contact_pairs(low_actor_id, high_actor_id) values(${low},${high})`;
          await f.sql`insert into friendships(low_actor_id, high_actor_id, requester_actor_id, state, requested_at, accepted_at)
        values(${low},${high},${counterpart},${state},${requestedAt},${state === 'accepted' ? requestedAt : null})`;
        }
        const [low, high] = [recipient, requester].sort();
        const notification = createId();
        await f.sql`insert into notifications(id, user_id, kind, actor_id, friendship_low_actor_id, friendship_high_actor_id)
      values(${notification},${recipientUser},'friend_request_received',${requester},${low},${high})`;
        await f.sql`insert into notification_preferences(user_id,kind,channel,enabled)
      values(${recipientUser},'friend_request_received','email',false)`;

        await scratch.migrate((folder) => folder <= validation);
        expect<unknown>(
          await f.sql`select
            has_function_privilege('daisy_web', 'public.daisy_linked_adult_users_at(text,timestamptz)', 'EXECUTE') as web,
            has_function_privilege('daisy_realtime', 'public.daisy_linked_adult_users_at(text,timestamptz)', 'EXECUTE') as realtime`,
        ).toEqual([{ web: false, realtime: false }]);
        expect<unknown>(
          await f.sql`select state from friendships where ${recipient} in (low_actor_id, high_actor_id) order by state`,
        ).toEqual([{ state: 'accepted' }, { state: 'pending' }]);
        expect<unknown>(
          await f.sql`select kind from notifications where id=${notification}`,
        ).toEqual([{ kind: 'friend_request_received' }]);
        expect<unknown>(
          await f.sql`select enabled from notification_preferences where user_id=${recipientUser}`,
        ).toEqual([{ enabled: false }]);
        expect<unknown>(
          await f.sql`select public.daisy_effective_protection_choice(${recipientUser}) as choice`,
        ).toEqual([{ choice: { level: 'independent' } }]);
        expect<unknown>(
          await f.sql`select status, public.daisy_effective_protection_choice(${linkedChild}) as choice
          from guardian_links where id=${link}`,
        ).toEqual([{ status: 'active', choice: { level: 'guided' } }]);
        for (const choice of protectionChoices) {
          const [limits] =
            await f.sql`select * from public.daisy_expand_protection(${JSON.stringify(choice)}::text::jsonb)`;
          const expanded = protectionLimits(choice);
          expect<unknown>(limits).toEqual({
            friend_approval: expanded.friendApproval,
            friends_only: expanded.messageRequests === 'friends',
            ranked_allowed: expanded.rankedAllowed,
          });
        }
        const checks =
          await f.sql`select convalidated from pg_constraint where conname in (
      'notification_preferences_pair_check',
      'notifications_kind_check', 'notifications_subject_check')`;
        expect<unknown>(checks).toEqual(
          Array.from({ length: 3 }, () => ({ convalidated: true })),
        );
      } finally {
        await f.sql`delete from contact_pairs where ${recipient} in (low_actor_id, high_actor_id)`;
      }
    });
  },
  ddlTimeoutMs,
);
