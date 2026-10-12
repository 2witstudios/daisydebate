import { drizzle } from 'drizzle-orm/bun-sql';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { sql } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { requireTestServices } from '@daisy/config';
import { createMessagingInboxPage } from '../src/messaging/inbox-page';
import type {
  MessagingInboxDecision,
  MessagingInboxPageFacts,
} from '../src/messaging/inbox-page-contracts';
import { createMessagingTestFixture } from '../src/messaging/test-fixture';
import { withFixture, sqlStateOf } from './constraint-helpers';
setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);
type Owner = Pick<BunSQLDatabase, 'transaction'>;
/** The web runtime role, optionally parked before commit with its fences still held. */
const webOwner = (db: BunSQLDatabase, park?: Promise<void>): Owner => ({
  transaction: (work, options) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`set local role daisy_web`);
      const result = await work(tx);
      await park;
      return result;
    }, options),
});
const recording = (pages: MessagingInboxPageFacts[]) =>
  ({
    collection: () => undefined,
    entries: (facts) => {
      pages.push(facts);
      return facts.candidates.flatMap((c) => (c.hidden ? [] : [c.channelId]));
    },
  }) satisfies MessagingInboxDecision<string>;

test('inbox page reads one fenced fact set and continues from the last scanned candidate', async () => {
  await withFixture(url, async (f) => {
    const fixture = await createMessagingTestFixture(f.sql),
      db = drizzle({ client: f.sql });
    try {
      const read = createMessagingInboxPage(webOwner(db));
      const scope = { userId: fixture.userId, actorId: fixture.actorId };
      const pages: MessagingInboxPageFacts[] = [];
      const full = await read({ ...scope, limit: 1 }, recording(pages));
      const facts = pages[0]!;
      assert({
        given: 'one accepted DM association and a one-candidate page',
        should:
          'return its entry, both fenced accounts with current age, and continue after it',
        actual: {
          full,
          channel: facts.candidates[0]?.channel?.authority.kind,
          accounts: [...facts.accounts.keys()].sort(),
          ages: [...facts.accounts.values()].map((row) => row.age.state),
          account: facts.account?.actorId,
        },
        expected: {
          full: { entries: [fixture.channelId], nextAfter: fixture.channelId },
          channel: 'dm',
          accounts: [fixture.actorId, fixture.otherActorId].sort(),
          ages: ['known', 'known'],
          account: fixture.actorId,
        },
      });
      assert({
        given: 'a page larger than the remaining associations',
        should: 'end without continuation',
        actual: await read({ ...scope, limit: 2 }, recording([])),
        expected: { entries: [fixture.channelId], nextAfter: null },
      });
      await f.sql`insert into messaging_actor_states(channel_id,actor_id,following,hidden,notification_level) values(${fixture.channelId},${fixture.actorId},true,true,'all')`;
      assert({
        given: 'a full page whose every scanned candidate is hidden',
        should:
          'return no entries but still continue from the last scanned candidate',
        actual: await read({ ...scope, limit: 1 }, recording([])),
        expected: { entries: [], nextAfter: fixture.channelId },
      });
      await assertRejects({
        given: 'a denied collection',
        should: 'refuse the page before scanning associations',
        actual: () =>
          read(
            { ...scope, limit: 1 },
            {
              collection: () => {
                throw createAppError('AUTHORIZATION');
              },
              entries: () => {
                throw new Error('entries must not run');
              },
            },
          ),
        code: 'AUTHORIZATION',
      });
    } finally {
      await fixture.cleanup();
    }
  });
});

test('concurrent inbox pages share account, pair and channel fences while an exclusive writer is refused', async () => {
  await withFixture(url, async (f) => {
    const fixture = await createMessagingTestFixture(f.sql),
      db = drizzle({ client: f.sql });
    let release!: () => void;
    let parked!: () => void;
    const park = new Promise<void>((resolve) => (release = resolve));
    const reached = new Promise<void>((resolve) => (parked = resolve));
    try {
      const holder = createMessagingInboxPage(
        webOwner(
          db,
          (async () => {
            parked();
            await park;
          })(),
        ),
      );
      const held = holder(
        { userId: fixture.userId, actorId: fixture.actorId, limit: 1 },
        recording([]),
      );
      // Wait until the first page holds its fences and is parked before commit.
      await reached;
      const peer = await createMessagingInboxPage(webOwner(db))(
        {
          userId: fixture.otherUserId,
          actorId: fixture.otherActorId,
          limit: 1,
        },
        recording([]),
      );
      const writer = await f.sql.begin(async (tx) =>
        sqlStateOf(
          () =>
            tx`select id from users where id=${fixture.userId} for update nowait`,
        ),
      );
      const channelWriter = await f.sql.begin(async (tx) =>
        sqlStateOf(
          () =>
            tx`select id from messaging_channels where id=${fixture.channelId} for update nowait`,
        ),
      );
      release();
      assert({
        given:
          'a parked inbox page holding fences on the shared accounts, pair and channel',
        should:
          'let the peer page complete and refuse exclusive account and channel writers',
        actual: { peer, writer, channelWriter, held: await held },
        expected: {
          peer: { entries: [fixture.channelId], nextAfter: fixture.channelId },
          writer: '55P03',
          channelWriter: '55P03',
          held: { entries: [fixture.channelId], nextAfter: fixture.channelId },
        },
      });
    } finally {
      release();
      await fixture.cleanup();
    }
  });
});
