import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createDatabase } from '../src';
import { sqlStateOf, withFixture, type Fixture } from './constraint-helpers';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

const provisionalUser = async (fixture: Fixture) => {
  const userId = createId();
  await fixture.insert('users', { id: userId, username: null });
  return userId;
};

/** The claim inserts the human actor; track it so the purge removes it before its user. */
const claimAs = async (
  fixture: Fixture,
  database: ReturnType<typeof createDatabase>,
  userId: string,
  username: string,
) => {
  const outcome = await database.claimUsername({ userId, username });
  const [actor] =
    (await fixture.sql`select id from actors where user_id = ${userId}`) as {
      id: string;
    }[];
  if (actor) fixture.track('actors', actor.id);
  return outcome;
};

const accessOf = async (fixture: Fixture, userId: string) =>
  (await fixture.sql.unsafe(
    'select state, revision, provenance, decided_at is null as undecided from account_beta_access where user_id = $1',
    [userId],
  )) as Array<Record<string, unknown>>;

const eventsOf = async (fixture: Fixture, userId: string) =>
  (await fixture.sql.unsafe(
    'select from_state, to_state, revision, principal, command_id from account_access_events where user_id = $1',
    [userId],
  )) as Array<Record<string, unknown>>;

describe('a username claim enrols the account on the beta list (ADR 0075)', () => {
  test('the first claim writes a pending row, its event and the window digest', async () => {
    await withFixture(url, async (fixture) => {
      const userId = await provisionalUser(fixture);
      const database = createDatabase({ url, nextActorId: createId });
      try {
        const first = await claimAs(fixture, database, userId, `b-${userId}`);
        const retry = await claimAs(fixture, database, userId, `b-${userId}`);
        const [digest] = (await fixture.sql.unsafe(
          `select state, purpose, recipient_user_id, next_attempt_at > now() as later,
             dedupe_key = 'beta-requests:' || to_char(date_bin(interval '10 minutes', now(), timestamptz '2000-01-01 00:00:00+00') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') as this_window
           from mail_intents where purpose = 'beta-requests-digest'
           order by created_at desc limit 1`,
        )) as Array<Record<string, unknown>>;
        assert({
          given: 'a provisional account claiming a username, then retrying',
          should:
            'enrol it once as pending, audit it, and owe this window a digest sent when it closes',
          actual: {
            outcomes: [first.kind, retry.kind],
            access: await accessOf(fixture, userId),
            events: await eventsOf(fixture, userId),
            digest,
          },
          expected: {
            outcomes: ['claimed', 'unchanged'],
            access: [
              {
                state: 'pending',
                revision: 1,
                provenance: 'signup',
                undecided: true,
              },
            ],
            events: [
              {
                from_state: null,
                to_state: 'pending',
                revision: 1,
                principal: 'signup',
                command_id: null,
              },
            ],
            digest: {
              state: 'queued',
              purpose: 'beta-requests-digest',
              recipient_user_id: null,
              later: true,
              this_window: true,
            },
          },
        });
      } finally {
        await database.close();
      }
    });
  });

  test('the runtime role cannot rewrite the audit or the receipts', async () => {
    await withFixture(url, async (fixture) => {
      const userId = await provisionalUser(fixture);
      const database = createDatabase({ url, nextActorId: createId });
      try {
        await claimAs(fixture, database, userId, `r-${userId}`);
      } finally {
        await database.close();
      }
      const asWeb = (statement: string) =>
        sqlStateOf(() =>
          fixture.sql.begin(async (tx) => {
            await tx.unsafe('set local role daisy_web');
            await tx.unsafe(statement, [userId]);
          }),
        );
      assert({
        given: 'daisy_web updating or deleting audit events and receipts',
        should: 'be refused for lack of privilege',
        actual: [
          await asWeb(
            "update account_access_events set principal = 'signup' where user_id = $1",
          ),
          await asWeb('delete from account_access_events where user_id = $1'),
          await asWeb(
            'delete from operator_command_receipts where target_user_id = $1',
          ),
        ],
        expected: ['42501', '42501', '42501'],
      });
    });
  });
});

/** The migration's own backfill statements, run against a controlled cohort. */
const backfillStatements = () => {
  const root = join(import.meta.dir, '..', 'migrations');
  const folder = readdirSync(root).find((name) =>
    name.endsWith('_beta_access_expand'),
  );
  const text = readFileSync(join(root, folder!, 'migration.sql'), 'utf8');
  return text
    .split('--> statement-breakpoint')
    .map((statement) => statement.replace(/^-->.*$/gm, '').trim())
    .filter((statement) => statement.startsWith('INSERT INTO'));
};

test('the expand migration approves exactly the grandfathered cohort', async () => {
  const sql = new SQL(url, { max: 1 });
  const ids = {
    claimed: createId(),
    provisional: createId(),
    erased: createId(),
  };
  try {
    const rows = await sql
      .begin(async (tx) => {
        // Isolate the cohort: the backfill reads every user, so start from no beta rows.
        await tx.unsafe('delete from mail_intents');
        await tx.unsafe('delete from account_access_events');
        await tx.unsafe('delete from account_beta_access');
        await tx.unsafe('insert into users (id, username) values ($1, $2)', [
          ids.claimed,
          `g-${ids.claimed}`,
        ]);
        await tx.unsafe(
          "insert into actors (id, kind, user_id) values ($1, 'human', $2)",
          [createId(), ids.claimed],
        );
        await tx.unsafe('insert into users (id, username) values ($1, null)', [
          ids.provisional,
        ]);
        await tx.unsafe(
          "insert into users (id, username, name, deleted_at) values ($1, null, '', now())",
          [ids.erased],
        );
        await tx.unsafe(
          "insert into actors (id, kind, user_id) values ($1, 'human', $2)",
          [createId(), ids.erased],
        );
        for (const statement of backfillStatements())
          await tx.unsafe(statement);
        const cohort = await tx.unsafe(
          `select b.user_id, b.state, b.provenance, b.requested_at = u.created_at as requested_at_signup,
             e.to_state, e.principal, e.id ~ '^[a-z0-9]{24}$' as id_shape
           from account_beta_access b join users u on u.id = b.user_id
           join account_access_events e on e.user_id = b.user_id
           where b.user_id in ($1, $2, $3)`,
          Object.values(ids),
        );
        throw new RollbackWith(cohort);
      })
      .catch((error: unknown) => {
        if (error instanceof RollbackWith) return error.rows;
        throw error;
      });
    assert({
      given: 'a claimed live account, a provisional one and an erased one',
      should:
        'approve only the claimed account, as grandfathered, with a migration event',
      actual: rows,
      expected: [
        {
          user_id: ids.claimed,
          state: 'approved',
          provenance: 'grandfathered',
          requested_at_signup: true,
          to_state: 'approved',
          principal: 'migration:beta_access_expand',
          id_shape: true,
        },
      ],
    });
  } finally {
    await sql.close();
  }
});

class RollbackWith extends Error {
  constructor(readonly rows: unknown) {
    super('rollback');
  }
}
