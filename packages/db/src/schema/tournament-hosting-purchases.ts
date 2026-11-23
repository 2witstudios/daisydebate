import { listedWord } from '../lifecycle-sql';
import { billingModes } from '@daisy/protocol/billing-mode';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  paidHostingTiers,
  type PaidHostingTier,
} from '@daisy/protocol/lobby/hosting-tier';
import { createdAtColumn, oneOf, timestampColumn } from './columns';
import { tournaments } from './lobbies';
import { users } from './users';

export const tournamentHostingPurchaseStates = [
  'open',
  'paid',
  'expired',
] as const;
export type TournamentHostingPurchaseState =
  (typeof tournamentHostingPurchaseStates)[number];

/**
 * One payment for one hosted tournament (decision 80, ADR 0149): who paid,
 * which tier, how much and Stripe's ids. A tournament's tier is the highest
 * paid row; nothing else stores it. Card details never enter this table.
 */
export const tournamentHostingPurchases = pgTable(
  'tournament_hosting_purchases',
  {
    id: text('id').primaryKey(),
    lobbyId: text('lobby_id')
      .notNull()
      .references(() => tournaments.lobbyId, { onDelete: 'restrict' }),
    payerUserId: text('payer_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    tier: text('tier').$type<PaidHostingTier>().notNull(),
    /** USD cents charged: the tier's price, or the difference from the tier held. */
    amount: integer('amount').notNull(),
    mode: text('mode').$type<(typeof billingModes)[number]>().notNull(),
    state: text('state')
      .$type<TournamentHostingPurchaseState>()
      .notNull()
      .default('open'),
    vendorSessionId: text('vendor_session_id'),
    vendorPaymentIntentId: text('vendor_payment_intent_id'),
    receiptUrl: text('receipt_url'),
    createdAt: createdAtColumn(),
    paidAt: timestampColumn('paid_at'),
    expiredAt: timestampColumn('expired_at'),
  },
  (table) => [
    index('tournament_hosting_purchases_lobby_idx').on(
      table.lobbyId,
      table.createdAt,
    ),
    index('tournament_hosting_purchases_payer_idx').on(table.payerUserId),
    uniqueIndex('tournament_hosting_purchases_open_unique')
      .on(table.lobbyId)
      .where(
        sql`${table.state} = ${listedWord(tournamentHostingPurchaseStates, 'open')}`,
      ),
    uniqueIndex('tournament_hosting_purchases_session_unique').on(
      table.mode,
      table.vendorSessionId,
    ),
    check(
      'tournament_hosting_purchases_tier_check',
      oneOf(table.tier, paidHostingTiers),
    ),
    check(
      'tournament_hosting_purchases_state_check',
      oneOf(table.state, tournamentHostingPurchaseStates),
    ),
    check(
      'tournament_hosting_purchases_mode_check',
      oneOf(table.mode, billingModes),
    ),
    check(
      'tournament_hosting_purchases_amount_check',
      sql`${table.amount} > 0 and ${table.amount} <= 19900`,
    ),
    check(
      'tournament_hosting_purchases_identity_check',
      sql`${table.id} ~ '^[a-z0-9]{24}$'
    and (${table.vendorSessionId} is null or (${table.vendorSessionId} ~ '^cs_(test|live)_[A-Za-z0-9]+$' and length(${table.vendorSessionId}) <= 255))
    and (${table.vendorPaymentIntentId} is null or (${table.vendorPaymentIntentId} ~ '^pi_[A-Za-z0-9]+$' and length(${table.vendorPaymentIntentId}) <= 255))
    and (${table.receiptUrl} is null or (${table.receiptUrl} ~ '^https://pay[.]stripe[.]com/receipts/' and length(${table.receiptUrl}) <= 2048))`,
    ),
    check(
      'tournament_hosting_purchases_lifecycle_check',
      sql`case ${table.state}
    when 'open' then ${table.paidAt} is null and ${table.expiredAt} is null
    when 'paid' then ${table.paidAt} is not null and ${table.expiredAt} is null and ${table.vendorSessionId} is not null and ${table.vendorPaymentIntentId} is not null
    when 'expired' then ${table.paidAt} is null and ${table.expiredAt} is not null
    else false end`,
    ),
  ],
);
