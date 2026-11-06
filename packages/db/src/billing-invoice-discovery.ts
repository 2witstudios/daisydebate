import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import {
  advanceCleanup,
  cleanupWorkSchema,
  ownedInvoiceObservationSchema,
  ownsCleanupClaim,
  type CleanupWork,
  type CleanupEvent,
} from '@daisy/protocol/billing';
import type { BoundedTransaction } from './bounded-transaction';
import {
  lockCleanupJob,
  cleanupFacts,
  cleanupContext,
} from './billing-cleanup-authority';
import {
  retainInvoiceWitness,
  rearmInvoiceWitness,
} from './billing-invoice-observation';
import { privacyJobs } from './schema/privacy-jobs';
const knownReadsSchema = z
  .array(ownedInvoiceObservationSchema)
  .max(20)
  .refine((reads) => reads.every((read) => read.source.kind === 'unresolved'));
const readsSchema = knownReadsSchema.refine(
  (reads) => new Set(reads.map((read) => read.invoiceId)).size === reads.length,
);

const pageSchema = z
  .strictObject({ reads: readsSchema, more: z.boolean() })
  .refine((value) => !(value.more && value.reads.length === 0));
const incompleteSchema = z.strictObject({
  reads: knownReadsSchema.refine((reads) => reads.length > 0),
  retryAt: z.iso.datetime({ precision: 3 }),
});
type Discovery =
  | {
      readonly kind: 'page';
      readonly reads: z.infer<typeof readsSchema>;
      readonly more: boolean;
    }
  | {
      readonly kind: 'incomplete';
      readonly reads: z.infer<typeof readsSchema>;
      readonly retryAt: string;
    };
function invoiceHead(value: CleanupWork) {
  const parsed = cleanupWorkSchema.safeParse(value);
  return parsed.success &&
    parsed.data.kind === 'scan' &&
    parsed.data.lane === 'invoices' &&
    parsed.data.scan.kind === 'page'
    ? { ...parsed.data, lane: 'invoices' as const, scan: parsed.data.scan }
    : null;
}

/** Positively discovered invoice identities become durable before either cursor progress or incomplete-page retry. */
export function createBillingInvoiceDiscovery(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
}) {
  const retain = (
    jobId: string,
    claimId: string,
    request: NonNullable<ReturnType<typeof invoiceHead>>,
    discovery: Discovery,
  ) =>
    input.run(async (tx) => {
      const locked = await lockCleanupJob(tx, jobId);
      if (!locked?.state) return 'idle' as const;
      const state = locked.state,
        facts = await cleanupFacts(tx, locked.userId),
        route = facts.route;
      if (
        route.kind !== 'owned' ||
        discovery.reads.some(
          (read) =>
            read.mode !== route.mode ||
            read.customerId !== route.customerId ||
            repeatsPageCursor(discovery, read.invoiceId, request.scan.afterId),
        )
      )
        return 'idle' as const;
      const context = await cleanupContext(tx, jobId, facts.effects);
      if (!ownsCleanupClaim(state, claimId, request, context))
        return 'idle' as const;
      for (const read of discovery.reads) {
        const witness = await retainInvoiceWitness(tx, {
          read,
          context: {
            userId: locked.userId,
            closedAt: locked.closedAt,
            now: context.now,
          },
          nextId: input.nextId,
        });
        await rearmInvoiceWitness(tx, witness);
      }
      const current = await cleanupFacts(tx, locked.userId),
        finalContext = await cleanupContext(tx, jobId, current.effects);
      const { event, expected, increment } = discoveryTransition(
        discovery,
        claimId,
        request,
      );
      const transition = advanceCleanup(state, event, finalContext);
      if (
        transition.kind !== expected ||
        transition.state.kind === 'acknowledged'
      )
        throw createAppError('CONFLICT');
      await tx
        .update(privacyJobs)
        .set({
          billingCleanup: transition.state,
          retryAt: new Date(transition.state.retryAt),
          attempts: locked.row.attempts + increment,
        })
        .where(eq(privacyJobs.id, jobId));
      return transition.kind;
    });
  return {
    retainInvoicePage(
      jobId: string,
      claimId: string,
      work: CleanupWork,
      value: unknown,
    ) {
      const parsed = pageSchema.safeParse(value),
        request = invoiceHead(work);
      return parsed.success && request
        ? retain(jobId, claimId, request, { kind: 'page', ...parsed.data })
        : Promise.resolve('idle' as const);
    },
    deferInvoicePage(
      jobId: string,
      claimId: string,
      work: CleanupWork,
      value: unknown,
    ) {
      const parsed = incompleteSchema.safeParse(value),
        request = invoiceHead(work);
      return parsed.success && request
        ? retain(jobId, claimId, request, {
            kind: 'incomplete',
            ...parsed.data,
          })
        : Promise.resolve('idle' as const);
    },
  };
}

function repeatsPageCursor(
  discovery: Discovery,
  invoiceId: string,
  afterId: string | null,
) {
  return discovery.kind === 'page' && invoiceId === afterId;
}

function discoveryTransition(
  discovery: Discovery,
  claimId: string,
  work: CleanupWork,
) {
  const event: Extract<CleanupEvent, { kind: 'page' | 'failure' }> =
    discovery.kind === 'page'
      ? {
          kind: 'page',
          claimId,
          work,
          ids: discovery.reads.map((read) => read.invoiceId),
          more: discovery.more,
        }
      : { kind: 'failure', claimId, work, retryAt: discovery.retryAt };
  return {
    event,
    expected:
      discovery.kind === 'page' ? ('progress' as const) : ('failure' as const),
    increment: discovery.kind === 'page' ? 0 : 1,
  };
}
