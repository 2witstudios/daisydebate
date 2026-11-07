import { readFile } from 'node:fs/promises';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withFixture } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const migration = '20261107080513_fair_midnight';
const source = await readFile(
  new URL(`../migrations/${migration}/migration.sql`, import.meta.url),
  'utf8',
);

test(
  'canonical catalog retains main Beta/privacy data, exact final guards, trigger registrations and closed roles',
  async () => {
    const scratch = scratchDatabase(databaseUrl, 'can7vbrip0jcatalog');
    await scratch.create();
    try {
      await scratch.migrate((tag) => tag < migration);
      await withFixture(scratch.url, async (f) => {
        const actor = await f.actor();
        const [account] =
          await f.sql`select user_id from actors where id=${actor}`;
        const preapproval = createId(),
          job = createId();
        await f.insert('beta_preapprovals', {
          id: preapproval,
          email: `${preapproval}@example.test`,
        });
        await f.sql`with sampled as materialized(select clock_timestamp() as at)
          insert into privacy_jobs(id,subject_ref,vendor,created_at,retry_at)
          select ${job},${account.user_id},'posthog',at,at from sampled`;
        try {
          const read = async () => {
            const [beta] =
              await f.sql`select to_jsonb(row) as value from beta_preapprovals row where id=${preapproval}`;
            const [privacy] =
              await f.sql`select to_jsonb(row)-'billing_cleanup' as value from privacy_jobs row where id=${job}`;
            return [beta.value, privacy.value];
          };
          const before = await read();
          await scratch.migrate(() => true);
          const functions = [
            ...source.matchAll(
              /CREATE(?: OR REPLACE)? FUNCTION\s+([\w.]+)\([^;]*?AS\s+(\$\w*\$)([\s\S]*?)\2\s*;/gi,
            ),
          ]
            .map((m) => ({
              name: m[1]!.replace('public.', ''),
              body: m[3]!.trim(),
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
          const actualFunctions =
            await f.sql`select proname as name,prosrc as body from pg_proc where pronamespace='public'::regnamespace and proname=any(${functions.map((f) => f.name)}::text[]) order by proname`;
          const triggers = [
            ...source.matchAll(
              /CREATE TRIGGER\s+(\w+) BEFORE (INSERT OR UPDATE|UPDATE) ON ([\w.]+)\s+FOR EACH ROW EXECUTE FUNCTION ([\w.]+)\(\);/g,
            ),
          ]
            .map((m) => ({
              name: m[1]!,
              table: m[3]!.replace('public.', ''),
              function: m[4]!.replace('public.', ''),
              type: m[2] === 'UPDATE' ? 19 : 23,
              enabled: 'O',
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
          const actualTriggers =
            await f.sql`select t.tgname as name,c.relname as "table",p.proname as "function",t.tgtype::int as type,t.tgenabled as enabled from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_proc p on p.oid=t.tgfoid where t.tgname=any(${triggers.map((t) => t.name)}::text[]) order by t.tgname`;
          const names = [
            'billing_customers',
            'billing_subscriptions',
            'billing_webhook_events',
            'billing_purchases',
            'billing_refund_actions',
            'billing_payment_observations',
          ];
          const acl =
            await f.sql`select name,has_table_privilege('daisy_web',name,'SELECT') as "read",has_table_privilege('daisy_web',name,'INSERT') as "insert",has_table_privilege('daisy_web',name,'UPDATE') as "update",has_table_privilege('daisy_web',name,'DELETE') as "delete",has_table_privilege('daisy_realtime',name,'SELECT') as realtime from unnest(${names}::text[]) name order by name`;
          const [analysis] =
            await f.sql`select has_table_privilege('daisy_web','round_analyses','DELETE') as "delete"`;
          const [due] =
            await f.sql`select indexdef from pg_indexes where schemaname='public' and indexname='privacy_jobs_pending_vendor_due_idx'`;
          assert({
            given: 'populated actual main99 Beta and nonStripe privacy rows',
            should:
              'preserve both byte-for-byte through the canonical transition',
            actual: await read(),
            expected: before,
          });
          assert({
            given:
              'all final canonical SQL function bodies and trigger declarations',
            should:
              'install exactly nine matching functions and nine enabled registrations without intermediate versions',
            actual: [
              functions.length,
              triggers.length,
              actualFunctions.map((fn) => ({ ...fn, body: fn.body.trim() })),
              actualTriggers,
            ],
            expected: [9, 9, functions, triggers],
          });
          assert({
            given:
              'the actual final runtime role ACLs including inherited baseline defaults',
            should:
              'retain only intended web CRUD, explicitly refuse financial observation/action and analysis DELETE, keep realtime excluded and support bounded due scans',
            actual: [
              acl,
              analysis.delete,
              !!due &&
                due.indexdef.includes('(vendor, retry_at, id)') &&
                due.indexdef.includes('pending'),
            ],
            expected: [
              names.sort().map((name) => ({
                name,
                read: true,
                insert: true,
                update: true,
                delete: ![
                  'billing_refund_actions',
                  'billing_payment_observations',
                ].includes(name),
                realtime: false,
              })),
              false,
              true,
            ],
          });
          await scratch.migrate(() => true);
          assert({
            given:
              'a second normal migration invocation on the same canonical target',
            should:
              'remain journal-idempotent and preserve original Beta/privacy rows',
            actual: await read(),
            expected: before,
          });
        } finally {
          await f.sql`delete from privacy_jobs where id=${job}`;
        }
      });
    } finally {
      await scratch.drop();
    }
  },
  ddlTimeoutMs,
);
