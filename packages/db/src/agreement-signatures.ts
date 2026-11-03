import { and, eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { instrumented, type DatabaseEventSink } from './instrumented';
import type { PrivacyAdopter } from './privacy/contracts';
import { exportRows } from './privacy/export-rows';
import { agreementSignatures } from './schema/agreement-signatures';
import { seasons } from './schema/ratings';
import { transactionNow } from './room-command-facts';

type Tx = Pick<BunSQLDatabase, 'select' | 'insert'>;

/** Where a member stands on a version of the active season's waiver. */
export type ContentWaiverStanding = 'signed' | 'unsigned' | 'no-active-season';

/**
 * The active season under FOR SHARE, so a rollover cannot change which season
 * a Ready stands on before this transaction commits.
 */
const activeSeasonId = async (tx: Tx): Promise<string | null> => {
  const [season] = await tx
    .select({ id: seasons.id })
    .from(seasons)
    .where(eq(seasons.status, 'active'))
    .for('share');
  return season?.id ?? null;
};

export async function readContentWaiverStanding(
  tx: Tx,
  userId: string,
  version: string,
): Promise<ContentWaiverStanding> {
  const seasonId = await activeSeasonId(tx);
  if (!seasonId) return 'no-active-season';
  const [row] = await tx
    .select({ id: agreementSignatures.id })
    .from(agreementSignatures)
    .where(
      and(
        eq(agreementSignatures.userId, userId),
        eq(agreementSignatures.agreement, 'ranked-content-waiver'),
        eq(agreementSignatures.version, version),
        eq(agreementSignatures.seasonId, seasonId),
      ),
    );
  return row ? 'signed' : 'unsigned';
}

/** Records the notice a member was shown, once per member, version and Room. */
export async function recordCaptureNotice(
  tx: Tx,
  input: {
    readonly id: string;
    readonly userId: string;
    readonly version: string;
    readonly words: string;
    readonly roomId: string;
    readonly now: string;
  },
) {
  await tx
    .insert(agreementSignatures)
    .values({
      id: input.id,
      userId: input.userId,
      agreement: 'round-capture-notice',
      version: input.version,
      words: input.words,
      roomId: input.roomId,
      signedAt: new Date(input.now),
    })
    .onConflictDoNothing();
}

type Transaction = <T>(run: (tx: Tx) => Promise<T>) => Promise<T>;

export const agreementSignatureOperations = ({
  database,
  eventSink,
}: {
  readonly database: Pick<BunSQLDatabase, 'transaction'>;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => {
  const transaction = database.transaction.bind(database) as Transaction;
  return {
    readContentWaiverStanding: (userId: string, version: string) =>
      instrumented(eventSink, 'readContentWaiverStanding', () =>
        transaction((tx) => readContentWaiverStanding(tx, userId, version)),
      ),
    /** Signs for the active season; signing again keeps the first signature. */
    signContentWaiver: (input: {
      readonly id: string;
      readonly userId: string;
      readonly version: string;
      readonly words: string;
    }): Promise<'signed' | 'no-active-season'> =>
      instrumented(eventSink, 'signContentWaiver', () =>
        transaction(async (tx) => {
          const seasonId = await activeSeasonId(tx);
          if (!seasonId) return 'no-active-season';
          await tx
            .insert(agreementSignatures)
            .values({
              id: input.id,
              userId: input.userId,
              agreement: 'ranked-content-waiver',
              version: input.version,
              words: input.words,
              seasonId,
              signedAt: new Date(await transactionNow(tx as never)),
            })
            .onConflictDoNothing();
          return 'signed';
        }),
      ),
  };
};

/**
 * Exported to their member and kept on erasure: a signature is the evidence
 * behind ranked content that outlives the account (compliance.md, proposed
 * until counsel reviews it). The row holds no email or name.
 */
export const agreementSignaturePrivacyAdopter: PrivacyAdopter = {
  id: 'agreement-signatures',
  phase: 'after-close',
  erase: async () => undefined,
  export: async (tx, subject) => ({
    agreement_signatures: exportRows(
      (await tx.execute(
        sql`select agreement,version,words,season_id,room_id,signed_at from ${agreementSignatures} where user_id=${subject.userId} order by signed_at, id`,
      )) as unknown as Record<string, unknown>[],
    ),
  }),
};
