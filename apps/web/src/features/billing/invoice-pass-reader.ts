import { z } from 'zod';
import type { Clock } from '@daisy/clock';
import {
  invoicePassSchema,
  invoicePassHeadSchema,
  invoicePassInvoiceSchema,
  type InvoicePass,
  type OwnedPaymentObservation,
} from '@daisy/protocol/billing';
import type { InvoicePassReadPort } from './invoice-pass-vendor';
import { normalizePaymentObservation } from './payment-observation-reader';
import { observeClosureInvoice } from './closure-payment';

const pageSchema = z.object({
  object: z.literal('list'),
  has_more: z.boolean(),
  data: z.array(z.unknown()).max(20),
});
const unavailable = { kind: 'unavailable' } as const;

/** Each call reads one current producer response. The current DB claim/pass separately admits its receipt. */
export function createInvoicePassReader(input: {
  readonly port: InvoicePassReadPort;
  readonly clock: Clock;
  readonly mode: 'test' | 'live';
}) {
  return async (pass: InvoicePass, claimId: string) => {
    if (
      !invoicePassSchema.safeParse(pass).success ||
      pass.owner.mode !== input.mode ||
      !invoicePassHeadSchema.shape.claimId.safeParse(claimId).success
    )
      return unavailable;
    const startedAt = input.clock.now();
    if (!invoicePassHeadSchema.shape.startedAt.safeParse(startedAt).success)
      return unavailable;
    try {
      if (pass.phase === 'verify-invoice')
        return await readInvoice(input, pass, claimId, startedAt);
      return await readPayments(input, pass, claimId, startedAt);
    } catch {
      // Neither transport errors nor missing facts establish absence or a completed pass.
      return unavailable;
    }
  };
}

async function readPayments(
  input: Parameters<typeof createInvoicePassReader>[0],
  pass: Exclude<InvoicePass, { phase: 'verify-invoice' }>,
  claimId: string,
  startedAt: string,
) {
  const request = paymentPageRequest(pass);
  const raw = await input.port.payments(request);
  const observedAt = input.clock.now();
  const page = readPaymentPage(raw, request.limit);
  if (!invoicePassHeadSchema.shape.observedAt.safeParse(observedAt).success)
    return unavailable;
  if (page === null) return unavailable;
  const normalized = normalizeMembers(page.data, pass, observedAt);
  if (normalized.kind === 'incomplete')
    return normalized.reads.length === 0
      ? unavailable
      : { kind: 'incomplete' as const, reads: normalized.reads };
  const reads = normalized.reads;
  if (pass.phase === 'verify-head') {
    const receipt = invoicePassHeadSchema.safeParse({
      ...receiptBinding(pass, claimId, startedAt, observedAt),
      kind: 'head',
      request: { invoiceId: pass.owner.invoiceId, limit: 20 },
      reads,
      hasMore: page.has_more,
    });
    return receipt.success
      ? {
          kind: 'advance' as const,
          event: { kind: 'head' as const, receipt: receipt.data },
        }
      : unavailable;
  }
  if (reads.length === 0)
    return page.has_more
      ? unavailable
      : {
          kind: 'advance' as const,
          event: { kind: 'exhausted' as const, beforeId: pass.afterId },
        };
  return {
    kind: 'advance' as const,
    event: {
      kind: 'retained' as const,
      beforeId: pass.afterId,
      read: reads[0]!,
      more: page.has_more,
    },
  };
}

function readPaymentPage(raw: unknown, limit: 1 | 20) {
  const parsed = pageSchema.safeParse(raw);
  return parsed.success && parsed.data.data.length <= limit
    ? parsed.data
    : null;
}

function paymentPageRequest(
  pass: Exclude<InvoicePass, { phase: 'verify-invoice' }>,
) {
  return pass.phase === 'verify-head'
    ? { invoice: pass.owner.invoiceId, limit: 20 as const }
    : {
        invoice: pass.owner.invoiceId,
        limit: 1 as const,
        ...(pass.afterId === null ? {} : { starting_after: pass.afterId }),
      };
}

function normalizeMembers(
  raw: readonly unknown[],
  pass: InvoicePass,
  now: string,
) {
  const reads: OwnedPaymentObservation[] = [];
  for (const member of raw) {
    const id = z.object({ id: z.string() }).safeParse(member);
    if (!id.success) continue;
    const { mode, customerId, invoiceId, source } = pass.owner;
    const result = normalizePaymentObservation(member, {
      invoice: { mode, customerId, invoiceId, source },
      paymentId: id.data.id,
      closedAt: pass.owner.closedAt,
      now,
    });
    if (result.kind !== 'read') continue;
    reads.push(result.read);
  }
  return reads.length === raw.length &&
    new Set(reads.map((read) => read.invoicePaymentId)).size === reads.length
    ? { kind: 'complete' as const, reads }
    : { kind: 'incomplete' as const, reads };
}

function receiptBinding(
  pass: InvoicePass,
  claimId: string,
  startedAt: string,
  observedAt: string,
) {
  return {
    passId: pass.id,
    jobId: pass.jobId,
    claimId,
    startedAt,
    observedAt,
    owner: pass.owner,
  };
}

async function readInvoice(
  input: Parameters<typeof createInvoicePassReader>[0],
  pass: InvoicePass,
  claimId: string,
  startedAt: string,
) {
  if (pass.owner.source.kind !== 'purchase') return unavailable;
  const source = pass.owner.source;
  const observed = observeClosureInvoice({
    owner: {
      mode: pass.owner.mode,
      customerId: pass.owner.customerId,
      vendorSubscriptionId: source.vendorSubscriptionId,
      priceId: source.priceId,
    },
    invoice: await input.port.invoice(pass.owner.invoiceId),
  });
  if (
    observed.kind !== 'invoice' ||
    observed.invoiceId !== pass.owner.invoiceId
  )
    return unavailable;
  const receipt = invoicePassInvoiceSchema.safeParse({
    ...receiptBinding(pass, claimId, startedAt, input.clock.now()),
    kind: 'invoice',
    owner: { ...pass.owner, period: observed.period },
  });
  return receipt.success
    ? {
        kind: 'advance' as const,
        event: { kind: 'invoice' as const, receipt: receipt.data },
      }
    : unavailable;
}
