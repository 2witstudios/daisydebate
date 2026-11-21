import { sql, type SQL as Statement } from 'drizzle-orm';
import type { ReservedSQL, SQL } from 'bun';
import { run } from './raw-rows';
import type { Tx } from './tx';

/**
 * Every advisory lock `packages/db` takes, by what it serializes. Each key
 * is exactly the one the code took before the registry, so a SQL function
 * or another process taking the same lock still excludes it. PostgreSQL
 * keeps one 64-bit key and a pair of 32-bit keys apart: `(59002, x)` never
 * meets `hashtextextended(x, 59002)`.
 */
const lockBrand: unique symbol = Symbol('transaction lock');

export type TransactionLock = {
  readonly [lockBrand]: true;
  readonly name: TransactionLockName;
  readonly key: Statement;
};

const lock = (name: TransactionLockName, key: Statement): TransactionLock => ({
  [lockBrand]: true,
  name,
  key,
});

const samplerLockKey = 59003;

/** The closed registry: a lock not named here cannot be taken. */
export const transactionLocks = {
  /** One Room command id at a time (idempotent replay). */
  roomCommand: (commandId: string) =>
    lock('roomCommand', sql`hashtextextended(${commandId}, 59001)`),
  /** One Round command id at a time: judging, panel, attendance, writes. */
  roundCommand: (commandId: string) =>
    lock('roundCommand', sql`hashtextextended(${commandId}, 59002)`),
  /** One operator command id at a time: beta access, moderation, operators. */
  operatorCommand: (commandId: string) =>
    lock('operatorCommand', sql`hashtextextended(${commandId}, 59079)`),
  /** One Tab command id at a time. */
  tabCommand: (commandId: string) =>
    lock('tabCommand', sql`59002, hashtext(${commandId})`),
  /** One beta preapproval claim per normalized email. */
  betaPreapprovalEmail: (normalizedEmail: string) =>
    lock(
      'betaPreapprovalEmail',
      sql`hashtextextended(${normalizedEmail}, 59080)`,
    ),
  /** One public profile edit per actor. */
  publicProfile: (actorId: string) =>
    lock('publicProfile', sql`hashtextextended(${actorId}, 71043)`),
  /** One rating projection per ladder seat (`hashtext(ladder || ':' || actor)`). */
  ratingSeat: (seatKey: number) =>
    lock('ratingSeat', sql`59090, ${seatKey}::integer`),
  /** Bot admission is serialized across Rounds. */
  botAdmission: () => lock('botAdmission', sql`59003, 1`),
  /** The flags table: readers share it, a change holds it alone. */
  flags: () => lock('flags', sql`59118, 1`),
  /** Season creation is serialized. */
  seasonCreation: () => lock('seasonCreation', sql`59091, 1`),
  /** Non-ranked capture capacity is admitted one at a time. */
  nonrankedCaptureCapacity: () => lock('nonrankedCaptureCapacity', sql`59081`),
  /** Necessary-evidence capacity is admitted one at a time. */
  necessaryEvidenceCapacity: () =>
    lock(
      'necessaryEvidenceCapacity',
      sql`hashtextextended('necessary-evidence-capacity', 0)`,
    ),
  /** Round analysis capacity is admitted one at a time. */
  roundAnalysisCapacity: () =>
    lock(
      'roundAnalysisCapacity',
      sql`hashtextextended('round-analysis-capacity', 59004)`,
    ),
  /** The resolution bank is drawn from one at a time. */
  resolutionBank: () =>
    lock('resolutionBank', sql`hashtextextended('resolution-bank', 59002)`),
  /** Tab setting chains change one at a time. */
  tabSettingsChains: () =>
    lock('tabSettingsChains', sql`hashtextextended('tab-settings-chains', 0)`),
  /** One Tab lobby handle claim per handle, ignoring case. */
  tabLobbyHandle: (handle: string) =>
    lock(
      'tabLobbyHandle',
      sql`hashtextextended(${`tab-lobby-handle:${handle.toLowerCase()}`}, 0)`,
    ),
  /** One Tab organization handle claim per handle, ignoring case. */
  tabOrganizationHandle: (handle: string) =>
    lock(
      'tabOrganizationHandle',
      sql`hashtextextended(${`tab-organization-handle:${handle.toLowerCase()}`}, 0)`,
    ),
} as const;

type TransactionLockName = keyof typeof transactionLocks;

/**
 * Takes `lock` until the transaction ends: alone by default, or shared with
 * other shared holders. The caller must supply an active transaction.
 */
export async function takeLock(
  tx: Tx,
  { key }: TransactionLock,
  mode: 'exclusive' | 'shared' = 'exclusive',
) {
  await run(
    tx,
    mode === 'shared'
      ? sql`select pg_advisory_xact_lock_shared(${key})`
      : sql`select pg_advisory_xact_lock(${key})`,
  );
}

/**
 * Session locks on a Bun SQL connection, held until released or the
 * connection ends. Each names the one connection that holds it.
 */
export const sessionLocks = {
  /** Serializes slot administration. Both calls use the same single-connection admin client. */
  slotAdmin: {
    take: async (admin: SQL) => {
      await admin`select pg_advisory_lock(hashtext('daisy-slot-admin'))`;
    },
    release: async (admin: SQL) => {
      await admin`select pg_advisory_unlock(hashtext('daisy-slot-admin'))`;
    },
  },
  /**
   * A test run database's liveness: its runner holds it for the run.
   * Both calls use the same single-connection admin client. Pass the
   * database name without SQL identifier quotes.
   */
  testRun: {
    tryTake: async (admin: SQL, name: string): Promise<boolean> => {
      const [row]: { free: boolean }[] =
        await admin`select pg_try_advisory_lock(hashtextextended(${name}, 0)) as free`;
      return row?.free === true;
    },
    release: async (admin: SQL, name: string) => {
      await admin`select pg_advisory_unlock(hashtextextended(${name}, 0))`;
    },
  },
  /** The availability sampler: one elected producer session. */
  availabilitySampler: {
    key: samplerLockKey,
    /** Elected when this session holds the lock already or takes it now. */
    elect: async (session: ReservedSQL): Promise<boolean> => {
      const [row]: { elected: boolean }[] =
        await session`select case when exists(select 1 from pg_locks
          where locktype='advisory' and pid=pg_backend_pid() and classid=0
            and objid=${samplerLockKey}::oid and objsubid=1 and granted)
          then true else pg_try_advisory_lock(${samplerLockKey}::bigint) end as elected`;
      return row?.elected === true;
    },
    release: async (session: ReservedSQL) => {
      await session`select pg_advisory_unlock(${samplerLockKey}::bigint)`;
    },
  },
} as const;
