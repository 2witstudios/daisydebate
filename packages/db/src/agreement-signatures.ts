import { and, eq, sql } from 'drizzle-orm';
import { daisyOrganizationId } from './daisy-reference';
import { instrumented, type DatabaseEventSink } from './instrumented';
import type { PrivacyAdopter } from './privacy/contracts';
import { exportRows } from './privacy/export-rows';
import { agreementSignatures } from './schema/agreement-signatures';
import { seasons } from './schema/ratings';
import { transactionNow } from './room-command-facts';
import { divisionAgeBand, divisionOfBandSql } from './ladder-division-band';
import { inTransaction, type Tx, type TxOpener } from './tx';

/** Where a member stands on a version of their division's active season's waiver. */
export type ContentWaiverStanding = 'signed' | 'unsigned' | 'no-active-season';

/**
 * The member's own active season under FOR SHARE: Daisy's season on the
 * member's ladder division (ADR 0147), so a Youth member signs for the Youth
 * season. FOR SHARE, so a rollover cannot change which season a Ready stands
 * on before this transaction commits. None without a division.
 */
const activeSeasonId = async (
  tx: Tx,
  userId: string,
): Promise<string | null> => {
  const [season] = await tx
    .select({ id: seasons.id })
    .from(seasons)
    // Daisy's own season: every organization may have an active one.
    .where(
      and(
        eq(seasons.status, 'active'),
        eq(seasons.organizationId, daisyOrganizationId),
        eq(
          seasons.division,
          sql`(select ${divisionOfBandSql(divisionAgeBand())} from account_age where account_age.user_id = ${userId})`,
        ),
      ),
    )
    .for('share');
  return season?.id ?? null;
};

export async function readContentWaiverStanding(
  tx: Tx,
  userId: string,
  version: string,
): Promise<ContentWaiverStanding> {
  const seasonId = await activeSeasonId(tx, userId);
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

export const agreementSignatureOperations = ({
  database,
  eventSink,
}: {
  readonly database: TxOpener;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => {
  return {
    readContentWaiverStanding: (userId: string, version: string) =>
      instrumented(eventSink, 'readContentWaiverStanding', () =>
        inTransaction(database, (tx) =>
          readContentWaiverStanding(tx, userId, version),
        ),
      ),
    /** Signs for the active season; signing again keeps the first signature. */
    signContentWaiver: (input: {
      readonly id: string;
      readonly userId: string;
      readonly version: string;
      readonly words: string;
    }): Promise<'signed' | 'no-active-season'> =>
      instrumented(eventSink, 'signContentWaiver', () =>
        inTransaction(database, async (tx) => {
          const seasonId = await activeSeasonId(tx, input.userId);
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
              signedAt: new Date(await transactionNow(tx)),
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
      await tx.execute(
        sql`select agreement,version,words,season_id,room_id,lobby_id,signed_at from ${agreementSignatures} where user_id=${subject.userId} order by signed_at, id`,
      ),
    ),
  }),
};
