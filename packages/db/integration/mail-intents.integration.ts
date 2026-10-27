import { createId } from '@paralleldrive/cuid2';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import type { createDatabase } from '../src';
import { withFixture, type Fixture, withDatabase } from './constraint-helpers';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

const token = () => `${createId()}${createId()}`;

/** An intent due long ago, so a claim takes it before any real queue entry. */
const dueIntent = async (
  fixture: Fixture,
  row: {
    purpose: string;
    recipient?: string | null;
    dedupeKey?: string;
    /** A digest's window; digests default to one long past. */
    windowStart?: string;
  },
) => {
  const id = createId();
  const digest = row.purpose === 'beta-requests-digest';
  await fixture.sql.unsafe(
    `insert into mail_intents (id, purpose, recipient_user_id, dedupe_key, window_start, next_attempt_at)
     values ($1, $2, $3, $4, $5::timestamptz, timestamptz '2000-01-01 00:00:00+00')`,
    [
      id,
      row.purpose,
      row.recipient ?? null,
      row.dedupeKey ?? `test:${id}`,
      digest ? (row.windowStart ?? '2000-01-01T00:00:00Z') : null,
    ],
  );
  return id;
};

const member = async (
  fixture: Fixture,
  state: 'pending' | 'approved' | 'revoked',
  erased = false,
) => {
  const id = createId();
  await fixture.insert(
    'users',
    erased
      ? { id, username: null, email: null, name: '', deleted_at: new Date() }
      : { id, username: `m-${id}`, email: `${id}@beta.invalid` },
  );
  await fixture.sql.unsafe(
    `insert into account_beta_access (user_id, state, requested_at, decided_at, provenance)
     values ($1, $2, now(), case when $2 = 'pending' then null else now() end, 'signup')`,
    [id, state],
  );
  return id;
};

const stateOf = async (fixture: Fixture, id: string) => {
  const [row] = (await fixture.sql.unsafe(
    'select state, attempts, last_error_code, completed_at is not null as completed from mail_intents where id = $1',
    [id],
  )) as Array<Record<string, unknown>>;
  return row;
};

const claim = (database: ReturnType<typeof createDatabase>) =>
  database.claimMailIntents({ limit: 50, leaseMs: 60_000, nextToken: token });

/** One due approval intent for an approved member, removed afterwards. */
const withApprovedIntent = (
  run: (input: {
    readonly fixture: Fixture;
    readonly id: string;
    readonly database: ReturnType<typeof createDatabase>;
  }) => Promise<void>,
) =>
  withFixture(url, async (fixture) => {
    const recipient = await member(fixture, 'approved');
    const id = await dueIntent(fixture, {
      purpose: 'beta-approved',
      recipient,
    });
    try {
      await withDatabase(url, (database) => run({ fixture, id, database }));
    } finally {
      await fixture.sql.unsafe('delete from mail_intents where id = $1', [id]);
    }
  });

describe('the durable mail queue (ADR 0075)', () => {
  test('a claim leases due intents once, and only the holder settles them', async () => {
    await withApprovedIntent(async ({ fixture, id, database }) => {
      const [first, second] = await Promise.all([
        claim(database),
        claim(database),
      ]);
      const claims = [...first, ...second].filter((claim) => claim.id === id);
      const stranger = await database.settleMailIntent({
        id,
        token: token(),
        outcome: { kind: 'sent' },
      });
      const holder = await database.settleMailIntent({
        id,
        token: claims[0]!.token,
        outcome: { kind: 'sent' },
      });
      assert({
        given:
          'two workers claiming at once, then a stranger and the holder settling',
        should:
          'lease the intent to exactly one worker and accept only the holder',
        actual: {
          claimed: claims.map(({ purpose, attempts }) => ({
            purpose,
            attempts,
          })),
          stranger,
          holder,
          row: await stateOf(fixture, id),
        },
        expected: {
          claimed: [{ purpose: 'beta-approved', attempts: 1 }],
          stranger: false,
          holder: true,
          row: {
            state: 'sent',
            attempts: 1,
            last_error_code: null,
            completed: true,
          },
        },
      });
    });
  });

  test('a lapsed lease is claimed again and a retry waits for its next attempt', async () => {
    await withApprovedIntent(async ({ fixture, id, database }) => {
      const mine = async () =>
        (await claim(database)).filter((held) => held.id === id);
      const [crashed] = await mine();
      // The holder crashed: its lease has run out by the database's clock.
      await fixture.sql.unsafe(
        "update mail_intents set lease_expires_at = now() - interval '1 second' where id = $1",
        [id],
      );
      const [again] = await mine();
      const late = await database.settleMailIntent({
        id,
        token: crashed!.token,
        outcome: { kind: 'sent' },
      });
      await database.settleMailIntent({
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
          'a worker that crashed holding a lease, and a later worker that retries',
        should:
          'reclaim the intent, refuse the crashed holder, and queue it for later',
        actual: {
          attempts: [crashed?.attempts, again?.attempts],
          late,
          row: await stateOf(fixture, id),
          reclaimed: (await mine()).length,
        },
        expected: {
          attempts: [1, 2],
          late: false,
          row: {
            state: 'queued',
            attempts: 2,
            last_error_code: 'delivery',
            completed: false,
          },
          reclaimed: 0,
        },
      });
    });
  });

  test('delivery is read fresh: approved, revoked, erased', async () => {
    await withFixture(url, async (fixture) => {
      const approved = await member(fixture, 'approved');
      const revoked = await member(fixture, 'revoked');
      const erased = await member(fixture, 'approved', true);
      const ids = await Promise.all(
        [approved, revoked, erased].map((recipient) =>
          dueIntent(fixture, { purpose: 'beta-approved', recipient }),
        ),
      );
      await withDatabase(url, async (database) => {
        assert({
          given:
            'approval mail for an approved, a since-revoked and an erased account',
          should: 'address only the approved account, by its current address',
          actual: await Promise.all(
            ids.map((id) => database.readMailIntentDelivery(id)),
          ),
          expected: [
            {
              kind: 'member',
              to: `${approved}@beta.invalid`,
              username: `m-${approved}`,
            },
            { kind: 'not-owed' },
            { kind: 'recipient-gone' },
          ],
        });
      });
      for (const id of ids)
        await fixture.sql.unsafe('delete from mail_intents where id = $1', [
          id,
        ]);
    });
  });

  test('a digest counts the accounts that joined in its window and still wait', async () => {
    await withFixture(url, async (fixture) => {
      const window = '2001-02-03T04:10';
      const inWindow = await member(fixture, 'pending');
      const approvedSince = await member(fixture, 'approved');
      for (const userId of [inWindow, approvedSince])
        await fixture.sql.unsafe(
          `update account_beta_access set requested_at = timestamptz '2001-02-03 04:15:00+00' where user_id = $1`,
          [userId],
        );
      const id = await dueIntent(fixture, {
        purpose: 'beta-requests-digest',
        dedupeKey: `beta-requests:${window}Z`,
        windowStart: `${window}:00Z`,
      });
      const empty = await dueIntent(fixture, {
        purpose: 'beta-requests-digest',
        dedupeKey: 'beta-requests:2001-02-03T05:00Z',
        windowStart: '2001-02-03T05:00:00Z',
      });
      await withDatabase(url, async (database) => {
        const digest = await database.readMailIntentDelivery(id);
        assert({
          given:
            'one pending and one already approved account in a window, and an empty window',
          should:
            'count only the waiting account, and owe nothing for the empty window',
          actual: {
            kind: digest.kind,
            newRequests:
              digest.kind === 'owner-digest' ? digest.newRequests : null,
            waitingCovers:
              digest.kind === 'owner-digest' ? digest.waiting >= 1 : null,
            empty: await database.readMailIntentDelivery(empty),
          },
          expected: {
            kind: 'owner-digest',
            newRequests: 1,
            waitingCovers: true,
            empty: { kind: 'not-owed' },
          },
        });
      });
      for (const intent of [id, empty])
        await fixture.sql.unsafe('delete from mail_intents where id = $1', [
          intent,
        ]);
    });
  });

  test('retention purges only finished intents past the cutoff', async () => {
    await withFixture(url, async (fixture) => {
      const finished = await dueIntent(fixture, {
        purpose: 'beta-requests-digest',
      });
      const waiting = await dueIntent(fixture, {
        purpose: 'beta-requests-digest',
      });
      await fixture.sql.unsafe(
        "update mail_intents set state = 'sent', completed_at = timestamptz '2001-01-01 00:00:00+00' where id = $1",
        [finished],
      );
      await withDatabase(url, async (database) => {
        await database.purgeExpiredMailIntents({
          before: '2002-01-01T00:00:00.000Z',
          limit: 500,
        });
      });
      const left = (await fixture.sql.unsafe(
        'select id from mail_intents where id in ($1, $2)',
        [finished, waiting],
      )) as Array<{ id: string }>;
      assert({
        given: 'a sent intent past the cutoff and a queued one',
        should: 'delete the sent intent and keep the queued one',
        actual: left.map(({ id }) => id),
        expected: [waiting],
      });
      await fixture.sql.unsafe('delete from mail_intents where id = $1', [
        waiting,
      ]);
    });
  });
});
