import { z } from 'zod';
import { idSchema } from '../primitives';
import { hostingTiers, paidHostingTiers } from './hosting-tier';

const tier = z.enum(hostingTiers);
const paidTier = z.enum(paidHostingTiers);
const cents = z.number().int().positive();
const count = z.number().int().nonnegative();

/** One hosting payment as its tournament's Billing lists it (ADR 0149). */
export const hostingPaymentViewSchema = z.strictObject({
  id: idSchema,
  at: z.iso.datetime(),
  tier: paidTier,
  payerName: z.string().max(200),
  amount: cents,
  state: z.enum(['paid', 'open', 'expired']),
  receiptUrl: z
    .string()
    .regex(/^https:\/\/pay\.stripe\.com\/receipts\//)
    .max(2048)
    .nullable(),
});

/** A host's view of one tournament's hosting: its tier, entries and payments. */
export const hostingAccountViewSchema = z.strictObject({
  lobbyId: idSchema,
  handle: z.string().min(1).max(80),
  name: z.string().min(1).max(200),
  tier,
  covered: z.boolean(),
  entryCap: count.nullable(),
  acceptedEntries: count,
  waitingEntries: count,
  upgrades: z.array(z.strictObject({ tier: paidTier, owed: cents })).max(2),
  payments: z.array(hostingPaymentViewSchema).max(100),
  settled: hostingPaymentViewSchema.nullable(),
});
export type HostingAccountReadView = z.infer<typeof hostingAccountViewSchema>;

/** The tournaments a person hosts themselves, for the host home. */
export const hostedTournamentsViewSchema = z.strictObject({
  tournaments: z
    .array(
      z.strictObject({
        handle: z.string().min(1).max(80),
        name: z.string().min(1).max(200),
        tier,
        division: z.enum(['open', 'youth']),
        acceptedEntries: count,
        entryCap: count.nullable(),
      }),
    )
    .max(100),
});
export type HostedTournamentsView = z.infer<typeof hostedTournamentsViewSchema>;
