import { z } from 'zod';
import { idSchema } from './primitives';
import { invoicePassSchema } from './billing-invoice-pass';
import type { BillingPaymentObservation } from './billing-payment-observation';
import {
  invoiceIdentityDebtSchema,
  nextInvoiceIdentity,
  type InvoiceIdentityDebt,
} from './billing-invoice-identity-debt';

export const cleanupLanes = [
  'purchases',
  'subscriptions',
  'invoices',
  'refunds',
  'observations',
] as const;
export type CleanupLane = (typeof cleanupLanes)[number];
const instant = z.iso.datetime({ precision: 3 });
const resourceId = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9_]+$/);
export const cleanupScanSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('page'), afterId: resourceId.nullable() }),
  z.strictObject({
    kind: z.literal('selected'),
    id: resourceId,
    rest: z.array(resourceId).max(19),
    lastId: resourceId,
    more: z.boolean(),
    detail: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('resource') }),
      z.strictObject({
        kind: z.literal('invoice-payments'),
        pass: invoicePassSchema.nullable(),
      }),
    ]),
  }),
  z.strictObject({ kind: z.literal('complete') }),
]);
export type CleanupScan = z.infer<typeof cleanupScanSchema>;
export const cleanupWorkSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('invoice-identity'),
    invoiceId: resourceId.regex(/^in_[A-Za-z0-9_]+$/),
  }),
  z.strictObject({
    kind: z.literal('scan'),
    lane: z.enum(cleanupLanes),
    scan: cleanupScanSchema,
  }),
  z.strictObject({ kind: z.literal('delete') }),
]);
export type CleanupWork = z.infer<typeof cleanupWorkSchema>;
const claim = z.strictObject({
  id: idSchema,
  claimedAt: instant,
  expiresAt: instant,
});
const active = {
  version: z.literal(2),
  jobId: idSchema,
  retryAt: instant,
  claim: claim.nullable(),
};
const laneScans = z.strictObject({
  purchases: cleanupScanSchema,
  subscriptions: cleanupScanSchema,
  invoices: cleanupScanSchema,
  refunds: cleanupScanSchema,
  observations: cleanupScanSchema,
});
const state = z.discriminatedUnion('kind', [
  z.strictObject({
    ...active,
    kind: z.literal('scanning'),
    turn: z.enum(cleanupLanes),
    scans: laneScans,
    invoiceDebt: invoiceIdentityDebtSchema,
  }),
  z.strictObject({ ...active, kind: z.literal('deleting') }),
  z.strictObject({
    kind: z.literal('acknowledged'),
    outcome: z.enum(['vendor-deleted', 'no-vendor-effects']),
    jobId: idSchema,
    checkedAt: instant,
    nextAt: instant,
  }),
]);
export type CleanupState = z.infer<typeof state>;
export const cleanupBounds = {
  claimMs: 30_000,
  progressMs: 1_000,
  recheckMs: 86_400_000,
  maxPage: 20,
} as const;
const at = Date.parse;
function laneId(lane: CleanupLane, id: string) {
  if (lane === 'purchases' || lane === 'refunds' || lane === 'observations')
    return idSchema.safeParse(id).success;
  return new RegExp(
    lane === 'subscriptions' ? '^sub_[A-Za-z0-9_]+$' : '^in_[A-Za-z0-9_]+$',
  ).test(id);
}
function validScan(lane: CleanupLane, scan: CleanupScan, jobId: string) {
  if (scan.kind === 'complete') return true;
  if (scan.kind === 'page')
    return scan.afterId === null || laneId(lane, scan.afterId);
  const ids = [scan.id, ...scan.rest];
  return (
    ids.every((id) => laneId(lane, id)) &&
    new Set(ids).size === ids.length &&
    ids.at(-1) === scan.lastId &&
    validDetail(lane, scan) &&
    (scan.detail.kind !== 'invoice-payments' ||
      scan.detail.pass === null ||
      scan.detail.pass.jobId === jobId)
  );
}
function validDetail(
  lane: CleanupLane,
  scan: Extract<CleanupScan, { kind: 'selected' }>,
) {
  if (scan.detail.kind === 'resource') return lane !== 'invoices';
  if (lane !== 'invoices' && lane !== 'observations') return false;
  return (
    scan.detail.pass === null ||
    lane === 'observations' ||
    scan.detail.pass.owner.invoiceId === scan.id
  );
}
function validCleanupClaimTime(
  value: Exclude<CleanupState, { kind: 'acknowledged' }>,
) {
  return (
    value.claim === null ||
    (at(value.claim.expiresAt) > at(value.claim.claimedAt) &&
      at(value.claim.expiresAt) <=
        at(value.claim.claimedAt) + cleanupBounds.claimMs &&
      at(value.claim.claimedAt) >= at(value.retryAt))
  );
}
export const billingCleanupSchema = state.refine((value) => {
  if (value.kind === 'acknowledged')
    return at(value.checkedAt) < at(value.nextAt);
  if (!validCleanupClaimTime(value)) return false;
  if (value.kind === 'deleting') return true;
  return (
    cleanupLanes.every((lane) =>
      validScan(lane, value.scans[lane], value.jobId),
    ) &&
    cleanupLanes.some((lane) => value.scans[lane].kind !== 'complete') &&
    (value.scans[value.turn].kind !== 'complete' ||
      (value.turn === 'observations' && value.invoiceDebt.kind === 'owed'))
  );
});
export type CleanupContext = {
  readonly now: string;
  readonly jobId: string;
  readonly closed: boolean;
  readonly observationOwner?: {
    readonly userId: string;
    readonly closedAt: string;
  };
  readonly effects?: {
    readonly mappedCustomers: number;
    readonly possiblePurchases: number;
    readonly retainedFinancialRoutes: number;
    readonly owedFinancialEffects: boolean;
  };
};
export type CleanupEvent =
  | { readonly kind: 'claim'; readonly claimId: string }
  | {
      readonly kind: 'invoice-identity-retained';
      readonly claimId: string;
      readonly work: CleanupWork;
      readonly observation: BillingPaymentObservation;
    }
  | {
      readonly kind: 'page';
      readonly claimId: string;
      readonly work: CleanupWork;
      readonly ids: readonly string[];
      readonly more: boolean;
    }
  | {
      readonly kind: 'resolved';
      readonly claimId: string;
      readonly work: CleanupWork;
    }
  | {
      /** Only the observation transaction may emit this after retaining its exact obligation. */
      readonly kind: 'retained';
      readonly claimId: string;
      readonly work: CleanupWork;
      readonly observation: BillingPaymentObservation;
    }
  | {
      readonly kind: 'failure';
      readonly claimId: string;
      readonly work: CleanupWork;
      readonly retryAt: string;
    }
  | {
      readonly kind: 'deleted';
      readonly claimId: string;
      readonly work: CleanupWork;
    }
  | {
      readonly kind: 'no-effects';
      readonly claimId: string;
      readonly work: CleanupWork;
    };
export function cleanupWork(value: CleanupState): CleanupWork | null {
  if (value.kind === 'acknowledged') return null;
  if (value.kind === 'scanning' && value.turn === 'observations') {
    const invoiceId = nextInvoiceIdentity(
      value.invoiceDebt,
      value.scans.observations.kind === 'complete',
    );
    if (invoiceId !== null) return { kind: 'invoice-identity', invoiceId };
  }
  return value.kind === 'deleting'
    ? { kind: 'delete' }
    : { kind: 'scan', lane: value.turn, scan: value.scans[value.turn] };
}
export function currentCleanup(value: CleanupState, context: CleanupContext) {
  return (
    billingCleanupSchema.safeParse(value).success &&
    instant.safeParse(context.now).success &&
    idSchema.safeParse(context.jobId).success &&
    context.closed &&
    value.jobId === context.jobId
  );
}
export function startCleanup(
  jobId: string,
  now: string,
  invoiceDebt: InvoiceIdentityDebt = { kind: 'none' },
): CleanupState | null {
  if (
    !idSchema.safeParse(jobId).success ||
    !instant.safeParse(now).success ||
    !invoiceIdentityDebtSchema.safeParse(invoiceDebt).success
  )
    return null;
  const page = { kind: 'page' as const, afterId: null };
  return {
    version: 2,
    kind: 'scanning',
    jobId,
    retryAt: now,
    claim: null,
    invoiceDebt,
    turn: 'purchases',
    scans: {
      purchases: page,
      subscriptions: page,
      invoices: page,
      refunds: page,
      observations: page,
    },
  };
}
