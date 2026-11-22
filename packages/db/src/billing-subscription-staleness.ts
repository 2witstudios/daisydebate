import { and, asc, desc, eq, gt, isNull, lte } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { billingSyncStateSchema } from '@daisy/protocol/billing';
import { idSchema } from '@daisy/protocol/primitives';
import type { BoundedTransaction } from './bounded-transaction';
import { readDatabaseTime } from './database-clock';
import { billingCustomers } from './schema/billing-customers';
import { billingSubscriptions } from './schema/billing-subscriptions';
import { users } from './schema/users';
import type { Tx } from './tx';

const pageSize = 33;
type Page = {
  readonly mode: 'test' | 'live';
  readonly afterId?: string;
  readonly throughId?: string;
};
const oldest = (values: readonly string[]) =>
  values.length ? values.reduce((a, b) => (a < b ? a : b)) : null;

function readPage(tx: Tx, end: string, afterId?: string) {
  // Do not filter mode/account after the keyset in SQL: even excluded rows consume the bounded page.
  return tx
    .select({
      id: billingCustomers.id,
      mode: billingCustomers.mode,
      erasedAt: users.deletedAt,
      synchronization: billingCustomers.synchronization,
      subscriptionCreatedAt: billingSubscriptions.createdAt,
      subscriptionObservedAt: billingSubscriptions.observedAt,
    })
    .from(billingCustomers)
    .innerJoin(users, eq(users.id, billingCustomers.userId))
    .leftJoin(
      billingSubscriptions,
      and(
        eq(billingCustomers.userId, billingSubscriptions.userId),
        eq(billingSubscriptions.current, true),
      ),
    )
    .where(
      and(
        isNull(billingCustomers.closedAt),
        lte(billingCustomers.id, end),
        ...(afterId === undefined ? [] : [gt(billingCustomers.id, afterId)]),
      ),
    )
    .orderBy(asc(billingCustomers.id))
    .limit(pageSize + 1);
}
function provenObservationAt(
  row: Awaited<ReturnType<typeof readPage>>[number],
  state: ReturnType<typeof billingSyncStateSchema.parse>,
  now: Date,
) {
  const { subscriptionCreatedAt, subscriptionObservedAt } = row;
  if (!subscriptionCreatedAt || !subscriptionObservedAt) return null;
  const created = subscriptionCreatedAt.getTime();
  const at = subscriptionObservedAt.getTime();
  // Mapping seeds observed_at. Only settled apply or a strictly later current-subscription
  // observation proves a vendor read; equality/missing/future/inconsistent facts stay unknown.
  return created <= at &&
    at <= now.getTime() &&
    (state.kind === 'settled'
      ? state.observedAt === subscriptionObservedAt.toISOString()
      : at > created)
    ? subscriptionObservedAt.toISOString()
    : null;
}
function pageFacts(
  rows: Awaited<ReturnType<typeof readPage>>,
  mode: Page['mode'],
  now: Date,
) {
  const requested: string[] = [],
    observed: string[] = [];
  let pending = 0,
    claimed = 0,
    settled = 0,
    unconfirmed = 0;
  for (const row of rows) {
    if (row.mode !== mode || row.erasedAt !== null) continue;
    const state = billingSyncStateSchema.parse(row.synchronization);
    if (state.kind === 'settled') settled++;
    else {
      if (state.kind === 'pending') pending++;
      else claimed++;
      requested.push(state.requestedAt);
    }
    const observation = provenObservationAt(row, state, now);
    if (observation) observed.push(observation);
    else unconfirmed++;
  }
  return {
    pending,
    claimed,
    settled,
    unconfirmed,
    oldestRevisionRequestedAt: oldest(requested),
    oldestObservedAt: oldest(observed),
  };
}
function checkPage(input: Page) {
  if (
    !['test', 'live'].includes(input.mode) ||
    (input.afterId === undefined) !== (input.throughId === undefined) ||
    (input.afterId !== undefined &&
      !idSchema.safeParse(input.afterId).success) ||
    (input.throughId !== undefined &&
      !idSchema.safeParse(input.throughId).success) ||
    (input.afterId !== undefined &&
      input.throughId !== undefined &&
      input.afterId > input.throughId)
  )
    throw createAppError('VALIDATION');
}

/** Read-only bounded observations. Cursors stay private; telemetry receives only aggregate facts. */
export function createBillingSubscriptionStaleness(run: BoundedTransaction) {
  return {
    sample(input: Page) {
      checkPage(input);
      return run(async (tx) => {
        const end =
          input.throughId ??
          (
            await tx
              .select({ id: billingCustomers.id })
              .from(billingCustomers)
              .where(isNull(billingCustomers.closedAt))
              .orderBy(desc(billingCustomers.id))
              .limit(1)
          )[0]?.id ??
          null;
        const found =
          end === null ? [] : await readPage(tx, end, input.afterId);
        const rows = found.slice(0, pageSize);
        const now = await readDatabaseTime(tx);
        return {
          sampledAt: now.toISOString(),
          throughId: end,
          afterId: rows.at(-1)?.id ?? null,
          exhausted: found.length <= pageSize,
          scanned: rows.length,
          ...pageFacts(rows, input.mode, now),
        };
      });
    },
  };
}
