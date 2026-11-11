import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { cancelPreapprovalInvitations } from '../src/beta-preapproval-claim';
import { mailIntentOperations } from '../src/mail-intents';
import { notificationEmailOperations } from '../src/notifications/email-jobs';
import { withFixture, type Fixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

const token = () => `${createId()}${createId()}`;
const LONG_AGO = '2000-01-01T00:00:00Z';

type Outcome =
  | { readonly kind: 'sent' }
  | {
      readonly kind: 'retry';
      readonly errorCode: 'delivery';
      readonly nextAttemptAt: string;
    };

/** One queue as its table's own operations expose it, and a job due long ago. */
type Queue = {
  readonly name: string;
  readonly table: 'mail_intents' | 'notification_emails';
  /** Whether this job's lapsed lease may have reached the provider. */
  readonly unknownAfterLapse: boolean;
  readonly seed: (f: Fixture) => Promise<string>;
  readonly claim: (
    f: Fixture,
    maxAttempts: number,
  ) => Promise<readonly { id: string; attempts: number; token: string }[]>;
  readonly settle: (
    f: Fixture,
    input: { id: string; token: string; outcome: Outcome },
  ) => Promise<boolean>;
};

/** A fixture that also removes the mail rows it wrote, which no account owns. */
const withMail = (body: (f: Fixture) => Promise<void>) =>
  withFixture(databaseUrl, async (f) => {
    try {
      await body(f);
    } finally {
      for (const table of [
        'mail_intents',
        'notification_emails',
        'beta_preapprovals',
      ])
        for (const id of f.tracked.get(table) ?? [])
          await f.sql.unsafe(`delete from ${table} where id = $1`, [id]);
    }
  });

const member = async (f: Fixture) => {
  const id = createId();
  await f.insert('users', {
    id,
    username: `m-${id}`,
    email: `${id}@mail-queue.invalid`,
  });
  return id;
};

const intents = (f: Fixture) =>
  mailIntentOperations({
    database: drizzle({ client: f.sql }),
    eventSink: undefined,
  });
const emails = (f: Fixture) =>
  notificationEmailOperations({ database: drizzle({ client: f.sql }) });

const claimInput = (maxAttempts: number) => ({
  limit: 50,
  leaseMs: 60_000,
  maxAttempts,
  nextToken: token,
});

const seedInvitation = async (f: Fixture) => {
  const id = createId();
  const preapprovalId = createId();
  await f.insert('beta_preapprovals', {
    id: preapprovalId,
    email: `${preapprovalId}@mail-queue.invalid`,
  });
  await f.sql`insert into mail_intents (id, purpose, preapproval_id, dedupe_key, next_attempt_at)
    values (${id}, 'beta-invitation', ${preapprovalId}, ${`test:${id}`}, ${LONG_AGO}::timestamptz)`;
  f.track('mail_intents', id);
  return { id, preapprovalId };
};

const queues: readonly Queue[] = [
  {
    name: 'an approval mail intent',
    table: 'mail_intents',
    unknownAfterLapse: false,
    seed: async (f) => {
      const id = createId();
      await f.sql`insert into mail_intents (id, purpose, recipient_user_id, dedupe_key, next_attempt_at)
        values (${id}, 'beta-approved', ${await member(f)}, ${`test:${id}`}, ${LONG_AGO}::timestamptz)`;
      f.track('mail_intents', id);
      return id;
    },
    claim: (f, max) => intents(f).claimMailIntents(claimInput(max)),
    settle: (f, input) => intents(f).settleMailIntent(input),
  },
  {
    name: 'an invitation mail intent',
    table: 'mail_intents',
    unknownAfterLapse: true,
    seed: async (f) => (await seedInvitation(f)).id,
    claim: (f, max) => intents(f).claimMailIntents(claimInput(max)),
    settle: (f, input) => intents(f).settleMailIntent(input),
  },
  {
    name: 'a notification email',
    table: 'notification_emails',
    unknownAfterLapse: true,
    seed: async (f) => {
      const id = createId();
      await f.sql`insert into notification_emails (id, user_id, kind, state, attempts, next_attempt_at)
        values (${id}, ${await member(f)}, 'room_invitation', 'queued', 0, ${LONG_AGO}::timestamptz)`;
      f.track('notification_emails', id);
      return id;
    },
    claim: (f, max) => emails(f).claimNotificationEmails(claimInput(max)),
    settle: (f, input) => emails(f).settleNotificationEmail(input),
  },
];

const rowOf = async (f: Fixture, table: Queue['table'], id: string) => {
  const [row] = (await f.sql.unsafe(
    `select state, attempts, last_error_code as code, completed_at is not null as completed,
       lease_token_digest is null and lease_expires_at is null as released
     from ${table} where id = $1`,
    [id],
  )) as Record<string, unknown>[];
  return row;
};

/** The holder died: its lease has run out by the database's clock. */
const lapse = (f: Fixture, table: Queue['table'], id: string) =>
  f.sql.unsafe(
    `update ${table} set lease_expires_at = clock_timestamp() - interval '1 second' where id = $1`,
    [id],
  );

for (const queue of queues)
  describe(`the mail queue: ${queue.name}`, () => {
    const mine = async (f: Fixture, id: string, maxAttempts = 8) =>
      (await queue.claim(f, maxAttempts)).filter((held) => held.id === id);
    const unknown = queue.unknownAfterLapse ? 'delivery-unknown' : null;

    test('a lapsed lease is claimed again, and only its new holder settles it', async () => {
      await withMail(async (f) => {
        const id = await queue.seed(f);
        const [crashed] = await mine(f, id);
        const held = (await mine(f, id)).length;
        await lapse(f, queue.table, id);
        const [again] = await mine(f, id);
        const reclaimed = await rowOf(f, queue.table, id);
        const late = await queue.settle(f, {
          id,
          token: crashed!.token,
          outcome: { kind: 'sent' },
        });
        const retried = await queue.settle(f, {
          id,
          token: again!.token,
          outcome: {
            kind: 'retry',
            errorCode: 'delivery',
            nextAttemptAt: '2999-01-01T00:00:00.000Z',
          },
        });
        assert({
          given:
            'a worker that died holding its lease, and the next worker retrying',
          should:
            'hold the job while leased, lease it again once lapsed, refuse the dead holder, and keep what the lapse left unknown',
          actual: {
            attempts: [crashed?.attempts, again?.attempts],
            held,
            reclaimed: [reclaimed?.state, reclaimed?.code],
            late,
            retried,
            row: await rowOf(f, queue.table, id),
            claimable: (await mine(f, id)).length,
          },
          expected: {
            attempts: [1, 2],
            held: 0,
            reclaimed: ['leased', unknown],
            late: false,
            retried: true,
            row: {
              state: 'queued',
              attempts: 2,
              code: unknown ?? 'delivery',
              completed: false,
              released: true,
            },
            claimable: 0,
          },
        });
      });
    });

    test('a job whose workers keep dying ends failed at the attempt cap', async () => {
      await withMail(async (f) => {
        const id = await queue.seed(f);
        const claims: number[] = [];
        for (let pass = 0; pass < 3; pass++) {
          claims.push((await mine(f, id, 2)).length);
          if ((await rowOf(f, queue.table, id))?.state === 'leased')
            await lapse(f, queue.table, id);
        }
        assert({
          given:
            'a cap of two attempts and a worker that dies after every claim',
          should:
            'lease the job twice, then end it failed instead of leasing it a third time',
          actual: { claims, row: await rowOf(f, queue.table, id) },
          expected: {
            claims: [1, 1, 0],
            row: {
              state: 'failed',
              attempts: 2,
              code: unknown ?? 'delivery',
              completed: true,
              released: true,
            },
          },
        });
      });
    });
  });

describe('cancelling mail that is no longer owed', () => {
  test('a removed grant ends its invitations at the database clock, held or not', async () => {
    await withMail(async (f) => {
      const queued = await seedInvitation(f);
      const held = await seedInvitation(f);
      const sent = await seedInvitation(f);
      const claims = await intents(f).claimMailIntents(claimInput(8));
      const tokenOf = (id: string) =>
        claims.find((claim) => claim.id === id)!.token;
      await intents(f).settleMailIntent({
        id: sent.id,
        token: tokenOf(sent.id),
        outcome: { kind: 'sent' },
      });
      await intents(f).settleMailIntent({
        id: queued.id,
        token: tokenOf(queued.id),
        outcome: {
          kind: 'retry',
          errorCode: 'delivery',
          nextAttemptAt: '2999-01-01T00:00:00.000Z',
        },
      });
      // A transaction that has been open a while: `now()` is its start, long past.
      const cancelledAfter = await drizzle({ client: f.sql }).transaction(
        async (tx) => {
          await tx.execute('select pg_sleep(0.05)');
          const [clock] = (await tx.execute(
            'select clock_timestamp() as at',
          )) as unknown as { at: Date }[];
          for (const { preapprovalId } of [queued, held, sent])
            await cancelPreapprovalInvitations(tx, preapprovalId);
          return clock!.at;
        },
      );
      const ended = async (id: string) => {
        const [row] = (await f.sql.unsafe(
          'select state, last_error_code as code, completed_at >= $2::timestamptz as "atClock" from mail_intents where id = $1',
          [id, cancelledAfter.toISOString()],
        )) as Record<string, unknown>[];
        return row;
      };
      assert({
        given:
          'a waiting invitation, one a worker holds and one already sent, each cancelled late in a transaction',
        should:
          'cancel the waiting one as not owed and the held one as unknown, at the clock of the write, and leave the sent one',
        actual: [
          await ended(queued.id),
          await ended(held.id),
          (await ended(sent.id))?.state,
        ],
        expected: [
          { state: 'cancelled', code: 'not-owed', atClock: true },
          { state: 'cancelled', code: 'delivery-unknown', atClock: true },
          'sent',
        ],
      });
    });
  });
});
