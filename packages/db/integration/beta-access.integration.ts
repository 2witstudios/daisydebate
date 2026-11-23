import { createOnboardingStore } from '../src/stores/onboarding';
import { openDatabaseResources } from '../src/resources';
import { hostWaits } from '@daisy/worker/host';
import { createId } from '@paralleldrive/cuid2';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { sqlStateOf, withFixture, type Fixture } from './constraint-helpers';
/** This file's database: the area stores it reads, over one set of resources. */
const openStores = (
  options: Parameters<typeof openDatabaseResources>[0] & {
    readonly nextActorId: () => string;
  },
) => {
  const resources = openDatabaseResources(options);
  return {
    ...createOnboardingStore(resources, { nextId: options.nextActorId }),
    close: resources.close,
  };
};

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
  database: ReturnType<typeof openStores>,
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
      const database = openStores({
        waits: hostWaits,
        url,
        nextActorId: createId,
      });
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
      const database = openStores({
        waits: hostWaits,
        url,
        nextActorId: createId,
      });
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
