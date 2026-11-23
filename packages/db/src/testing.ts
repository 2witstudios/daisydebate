import { query } from './raw-rows';
import { z } from 'zod';
import { SQL } from 'bun';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import {
  spectatorHorizonSql,
  type SpectatorClock,
} from './spectator-release-sql';

export { daisyOrganizationId, publicLobbyId } from './daisy-reference';
export { validRules } from './testing-rules';
export { seedRatingSeason } from './testing-rating-season';
export { completeControlledStripeCleanup } from './testing-billing';
export { completeControlledBillingPurchase } from './testing-billing-purchase';
export { fundTestClub } from './testing-club';
export { atFinalJudgingStage, syntheticCaseMap } from './testing-judging';

const POLL_INTERVAL_MS = 10;

/** Every other backend in the cluster that holds an xid, oldest first. */
const describeXidHolders = async (client: SQL): Promise<string> => {
  const holders: Array<{
    datname: string | null;
    pid: number;
    application_name: string;
    state: string | null;
    openMs: number | null;
  }> = await client.unsafe(`
    select datname, pid, application_name, state,
      (extract(epoch from now() - xact_start) * 1000)::int as "openMs"
    from pg_stat_activity
    where backend_xid is not null and pid <> pg_backend_pid()
    order by xact_start
  `);
  if (holders.length === 0) return 'no xid-holding transaction is open now';
  return holders
    .map(
      (holder) =>
        `database "${holder.datname ?? '?'}" pid ${holder.pid} (${holder.application_name || 'no application_name'}, ${holder.state ?? 'unknown state'}, open ${holder.openMs ?? '?'} ms)`,
    )
    .join('; ');
};

/**
 * Test support for suites that assert on `drainOutbox` or the drain loop
 * (ISSUE-82): resolves once the outbox position written by transaction
 * `txid` is final, i.e. below `pg_snapshot_xmin(pg_current_snapshot())`,
 * the exact condition the drain reads by (ADR 0032 §1). That xmin is
 * cluster-wide, so on a shared PostgreSQL any older xid-holding transaction
 * in any database holds the row back until it ends; a test that drains the
 * moment its own commit returns sees nothing. Waiting on the condition, not
 * a fixed delay, costs only as long as those older transactions run: xids
 * only increase, so transactions that start later never hold it back.
 * There is no server-side wakeup for xmin advancing, so this polls the
 * condition itself. Past `deadlineMs` it rejects naming every xid holder in
 * the cluster, so a stuck foreign transaction is reported, not a timeout.
 * The caller injects the clock (`now`, in milliseconds).
 */
export async function waitForOutboxFinality(
  client: SQL,
  txid: string,
  {
    now,
    deadlineMs = 3000,
  }: { readonly now: () => number; readonly deadlineMs?: number },
): Promise<void> {
  const deadline = now() + deadlineMs;
  for (;;) {
    const [row]: Array<{ final: boolean }> = await client.unsafe(
      'select pg_snapshot_xmin(pg_current_snapshot()) > $1::xid8 as final',
      [txid],
    );
    if (row?.final) return;
    if (now() >= deadline)
      throw new Error(
        `Outbox txid ${txid} is still not final after ${deadlineMs} ms; xid holders: ${await describeXidHolders(client)}`,
      );
    await Bun.sleep(POLL_INTERVAL_MS);
  }
}

/**
 * Test support for suites that pin a lock interleaving (ISSUE-22,
 * ISSUE-103): which comes first for `work`, finishing, or the database
 * reporting a backend blocked on a lock `holderPid` holds
 * (`pg_blocking_pids`, not a timer). Past `deadlineMs` it rejects, so work
 * that neither finishes nor blocks fails loudly instead of hanging the
 * suite. The caller injects the clock (`now`, in milliseconds).
 */
export async function finishedOrBlockedBehind(
  work: Promise<unknown>,
  observer: SQL,
  holderPid: number,
  {
    now,
    deadlineMs = 5000,
  }: { readonly now: () => number; readonly deadlineMs?: number },
): Promise<'finished' | 'blocked'> {
  const completion = { finished: false };
  void work.then(
    () => (completion.finished = true),
    () => (completion.finished = true),
  );
  const deadline = now() + deadlineMs;
  for (;;) {
    if (completion.finished) return 'finished';
    const [row]: Array<{ waiting: number }> = await observer.unsafe(
      'select count(*)::int as waiting from pg_stat_activity where $1 = any(pg_blocking_pids(pid))',
      [holderPid],
    );
    if ((row?.waiting ?? 0) > 0) return 'blocked';
    if (now() >= deadline)
      throw new Error(
        `Work neither finished nor blocked behind pid ${holderPid} within ${deadlineMs} ms`,
      );
    await Bun.sleep(POLL_INTERVAL_MS);
  }
}

export {
  createMessagingTestFixture,
  seedMessagingTestDm,
} from './messaging/test-fixture';

export {
  seedMessagingBrowserAccounts,
  cleanupMessagingBrowserData,
} from './messaging/browser-fixture';

export { createScriptedAuthorizationTransaction } from './testing-authorization';
export { withRolledBackDatabase } from './testing-rolled-back';
export {
  admitParticipants,
  approveBetaAccess,
  removeUnowedBetaDigests,
} from './beta-access-testing';
export { refuseCapacity } from './capacity-refusal';
export {
  eraseRoomAccountClosure,
  exportRoomAccountClosure,
} from './testing-room-account-closure';
export { refuseFinalSpeech } from './bot-generation-rules';

/** The database boundary's failure wrapper, for composing refusal telemetry across packages. */
export { instrumented } from './instrumented';

/** The list reads' horizon for one Round, for the suite that holds it equal to the engine's. */
export async function readSpectatorHorizon(
  url: string,
  roundId: string,
  clock: SpectatorClock,
): Promise<number | null> {
  const client = new SQL(url, { max: 1 });
  try {
    const rows = await query(
      drizzle({ client }),
      z.object({ horizon: z.union([z.date(), z.string()]).nullable() }),
      sql`select ${spectatorHorizonSql(
        {
          id: sql`r.id`,
          status: sql`r.status`,
          competitionType: sql`r.competition_type`,
          completedAt: sql`r.completed_at`,
        },
        clock,
      )} as horizon from rounds r where r.id=${roundId}`,
    );
    const horizon = rows[0]?.horizon ?? null;
    return horizon === null ? null : new Date(horizon).getTime();
  } finally {
    await client.close();
  }
}

export { scratchDatabase } from './testing-scratch';
export {
  withRuntimeTestTransaction,
  committingRuntimeTestDatabase,
  unusedTx,
  type SavepointTestDatabase,
} from './testing-transaction';

export { createGuardianStore } from './guardians/store';
export { ageStepOperations } from './age-step';
export { guardianLinksPrivacyAdopter } from './guardians/privacy';
export { scopeTransaction } from './tenant-scope';
export { friendsPrivacyAdopter } from './friends/privacy';
export { holdForGuardian } from './friends/hold-for-guardian';
export { listFriendships } from './friends/reads';
export { notificationInboxOperations } from './notifications/inbox';
export { pinRankedFixturePool } from './testing-rating-pool';
export { createLobbyPermissionStore } from './guardians/lobby-requests';
export {
  readGuardianLobbyIds,
  hasGuardianLobbyWaiver,
} from './guardians/lobby-permissions';
