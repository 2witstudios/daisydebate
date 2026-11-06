import { z } from 'zod';
import type { Clock } from '@daisy/clock';
import {
  invoicePassSchema,
  invoicePassHeadSchema,
  invoicePassInvoiceSchema,
  type InvoicePass,
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
      pass.owner.mode !== input.mode
    )
      return unavailable;
    const startedAt = input.clock.now();
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
  const parsed = pageSchema.safeParse(raw);
  if (!parsed.success || (request.limit === 1 && parsed.data.data.length > 1))
    return unavailable;
  const reads = normalizeMembers(parsed.data.data, pass, observedAt);
  if (!reads) return unavailable;
  if (pass.phase === 'verify-head') {
    const receipt = invoicePassHeadSchema.safeParse({
      ...receiptBinding(pass, claimId, startedAt, observedAt),
      kind: 'head',
      request: { invoiceId: pass.owner.invoiceId, limit: 20 },
      reads,
      hasMore: parsed.data.has_more,
    });
    return receipt.success
      ? {
          kind: 'advance' as const,
          event: { kind: 'head' as const, receipt: receipt.data },
        }
      : unavailable;
  }
  if (reads.length === 0)
    return parsed.data.has_more
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
      more: parsed.data.has_more,
    },
  };
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
  const reads = [];
  for (const member of raw) {
    const id = z.object({ id: z.string() }).safeParse(member);
    if (!id.success) return null;
    const { mode, customerId, invoiceId, source } = pass.owner;
    const result = normalizePaymentObservation(member, {
      invoice: { mode, customerId, invoiceId, source },
      paymentId: id.data.id,
      closedAt: pass.owner.closedAt,
      now,
    });
    if (result.kind !== 'read') return null;
    reads.push(result.read);
  }
  return new Set(reads.map((read) => read.invoicePaymentId)).size ===
    reads.length
    ? reads
    : null;
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
