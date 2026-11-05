import { z } from 'zod';
import { idSchema } from './primitives';

export const cleanupLanes = [
  'purchases',
  'subscriptions',
  'invoices',
  'refunds',
] as const;
export type CleanupLane = (typeof cleanupLanes)[number];
const instant = z.iso.datetime({ precision: 3 });
const resourceId = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9_]+$/);
const paymentId = z
  .string()
  .max(255)
  .regex(/^inpay_[A-Za-z0-9_]+$/);
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
        afterId: paymentId.nullable(),
      }),
    ]),
  }),
  z.strictObject({ kind: z.literal('complete') }),
]);
export type CleanupScan = z.infer<typeof cleanupScanSchema>;
export const cleanupWorkSchema = z.discriminatedUnion('kind', [
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
const active = { jobId: idSchema, retryAt: instant, claim: claim.nullable() };
const laneScans = z.strictObject({
  purchases: cleanupScanSchema,
  subscriptions: cleanupScanSchema,
  invoices: cleanupScanSchema,
  refunds: cleanupScanSchema,
});
const state = z.discriminatedUnion('kind', [
  z.strictObject({
    ...active,
    kind: z.literal('scanning'),
    turn: z.enum(cleanupLanes),
    scans: laneScans,
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
  if (lane === 'purchases' || lane === 'refunds')
    return idSchema.safeParse(id).success;
  return new RegExp(
    lane === 'subscriptions' ? '^sub_[A-Za-z0-9_]+$' : '^in_[A-Za-z0-9_]+$',
  ).test(id);
}
function validScan(lane: CleanupLane, scan: CleanupScan) {
  if (scan.kind === 'complete') return true;
  if (scan.kind === 'page')
    return scan.afterId === null || laneId(lane, scan.afterId);
  const ids = [scan.id, ...scan.rest];
  return (
    ids.every((id) => laneId(lane, id)) &&
    new Set(ids).size === ids.length &&
    ids.at(-1) === scan.lastId &&
    (lane === 'invoices'
      ? scan.detail.kind === 'invoice-payments'
      : scan.detail.kind === 'resource')
  );
}
export const billingCleanupSchema = state.refine((value) => {
  if (value.kind === 'acknowledged')
    return at(value.checkedAt) < at(value.nextAt);
  if (
    value.claim &&
    (at(value.claim.expiresAt) <= at(value.claim.claimedAt) ||
      at(value.claim.expiresAt) >
        at(value.claim.claimedAt) + cleanupBounds.claimMs ||
      at(value.claim.claimedAt) < at(value.retryAt))
  )
    return false;
  if (value.kind === 'deleting') return true;
  return (
    cleanupLanes.every((lane) => validScan(lane, value.scans[lane])) &&
    value.scans[value.turn].kind !== 'complete'
  );
});
export type CleanupContext = {
  readonly now: string;
  readonly jobId: string;
  readonly closed: boolean;
  readonly effects?: {
    readonly mappedCustomers: number;
    readonly possiblePurchases: number;
    readonly retainedFinancialRoutes: number;
  };
};
export type CleanupEvent =
  | { readonly kind: 'claim'; readonly claimId: string }
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
      readonly kind: 'payments';
      readonly claimId: string;
      readonly work: CleanupWork;
      readonly beforeId: string | null;
      readonly afterId: string | null;
      readonly exhausted: boolean;
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
export function startCleanup(jobId: string, now: string): CleanupState | null {
  if (!idSchema.safeParse(jobId).success || !instant.safeParse(now).success)
    return null;
  const page = { kind: 'page' as const, afterId: null };
  return {
    kind: 'scanning',
    jobId,
    retryAt: now,
    claim: null,
    turn: 'purchases',
    scans: {
      purchases: page,
      subscriptions: page,
      invoices: page,
      refunds: page,
    },
  };
}
