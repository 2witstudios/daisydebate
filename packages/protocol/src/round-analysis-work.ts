import { z } from 'zod';
import { idSchema } from './primitives';
import { roundAnalysisReportSchema } from './round-analysis';

/** Analysis capacity is independent of bot and judge work. */
export const analysisWorkBounds = {
  paidCalls: 2,
  requestMs: 15 * 60_000,
  leaseClaims: 4,
  leaseMs: 180_000,
} as const;
const instant = z.iso.datetime({ offset: true });
const count = z.int().nonnegative();

/** Original automatic-job observations: claims are possible calls, not dispatch proof. */
const historicalAnalysisSchema = z.strictObject({
  createdAt: instant,
  completedAt: instant.nullable(),
  claimedAttempts: count,
  model: z.string().min(1),
  inputTokens: count,
  outputTokens: count,
});
const callOutcome = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('unknown') }),
  z.strictObject({ kind: z.literal('definite_failure') }),
  z.strictObject({
    kind: z.literal('received'),
    inputTokens: count,
    outputTokens: count,
  }),
]);
const analysisCallSchema = z.strictObject({
  id: idSchema,
  tokenDigest: z.string().regex(/^[a-f0-9]{64}$/),
  model: z.string().min(1),
  dispatchedAt: instant,
  outcome: callOutcome,
});
const request = z.strictObject({
  requestId: idSchema,
  requestedAt: instant,
  deadlineAt: instant,
  evidenceLines: z.int().positive(),
  claims: count.max(analysisWorkBounds.leaseClaims),
  calls: z.array(analysisCallSchema).max(analysisWorkBounds.paidCalls),
});
const requested = {
  ...request.shape,
  historical: historicalAnalysisSchema.nullable(),
};
const lease = z.strictObject({
  callId: idSchema,
  tokenDigest: z.string().regex(/^[a-f0-9]{64}$/),
  model: z.string().min(1),
  expiresAt: instant,
  claimedAt: instant,
});

/** One seat identity; historical in-flight work has no request or dispatch authority. */
const work = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('unrequested'),
    historical: historicalAnalysisSchema,
  }),
  z.strictObject({
    kind: z.literal('retained'),
    historical: historicalAnalysisSchema,
    report: roundAnalysisReportSchema,
  }),
  z.strictObject({
    kind: z.literal('retired'),
    historical: historicalAnalysisSchema,
    reason: z.enum(['failed', 'erased']),
  }),
  z.strictObject({ kind: z.literal('queued'), ...requested }),
  z.strictObject({ kind: z.literal('leased'), ...requested, lease }),
  z.strictObject({
    kind: z.literal('succeeded'),
    ...requested,
    completedAt: instant,
    report: roundAnalysisReportSchema,
  }),
  z.strictObject({
    kind: z.literal('failed'),
    ...requested,
    completedAt: instant,
    reason: z.enum(['exhausted', 'authority', 'evidence', 'expired']),
  }),
  z.strictObject({
    kind: z.literal('purged'),
    historical: historicalAnalysisSchema.nullable(),
    request: request.nullable(),
    completedAt: instant.nullable(),
    purgedAt: instant,
  }),
]);
export type AnalysisCall = z.infer<typeof analysisCallSchema>;
export type AnalysisWork = z.infer<typeof work>;
export type AnalysisLease = z.infer<typeof lease>;
type AnalysisRequest = z.infer<typeof request>;
export type RequestedAnalysis = Extract<AnalysisWork, { requestedAt: string }>;

/** Purging content preserves the original requested-use evidence. */
export const analysisRequest = (state: AnalysisWork): AnalysisRequest | null =>
  state.kind === 'purged'
    ? state.request
    : 'requestedAt' in state
      ? state
      : null;
const at = (value: string) => Date.parse(value);
const issue = (ctx: z.RefinementCtx, message: string) =>
  ctx.addIssue({ code: 'custom', message });

function validateRequest(state: AnalysisWork, ctx: z.RefinementCtx) {
  const facts = analysisRequest(state);
  if (!facts) return;
  const { calls, requestedAt, deadlineAt, claims } = facts;
  if (at(deadlineAt) - at(requestedAt) !== analysisWorkBounds.requestMs)
    issue(ctx, 'The request deadline is fixed at admission');
  if (
    new Set(calls.map((call) => call.id)).size !== calls.length ||
    new Set(calls.map((call) => call.tokenDigest)).size !== calls.length
  )
    issue(ctx, 'Call identities must be unique');
  if (
    calls.some(
      (call) =>
        at(call.dispatchedAt) < at(requestedAt) ||
        at(call.dispatchedAt) >= at(deadlineAt),
    )
  )
    issue(ctx, 'Dispatch must be within the request authority');
  if (calls.length > claims)
    issue(ctx, 'A dispatch requires its claimed lease');
  if (state.historical && at(requestedAt) < at(state.historical.createdAt))
    issue(ctx, 'The request cannot precede historical observations');
  if (state.historical?.completedAt)
    issue(ctx, 'Historical terminal work cannot acquire a new request');
  if (
    state.kind === 'succeeded' &&
    !calls.some((c) => c.outcome.kind === 'received')
  )
    issue(ctx, 'A new report requires received service');
  if ('completedAt' in state && state.completedAt) {
    const final = at(state.completedAt);
    if (
      final < at(requestedAt) ||
      calls.some((c) => final < at(c.dispatchedAt))
    )
      issue(ctx, 'Completion cannot precede requested work');
    if (state.kind === 'succeeded' && final >= at(deadlineAt))
      issue(ctx, 'Publication requires unexpired request authority');
  }
}
function validateLease(
  state: Extract<AnalysisWork, { kind: 'leased' }>,
  ctx: z.RefinementCtx,
) {
  const { lease, calls } = state;
  const call = calls.find((call) => call.id === lease.callId);
  const duration = at(lease.expiresAt) - at(lease.claimedAt);
  if (
    state.claims === 0 ||
    at(lease.claimedAt) < at(state.requestedAt) ||
    duration <= 0 ||
    duration > analysisWorkBounds.leaseMs ||
    at(lease.expiresAt) > at(state.deadlineAt)
  )
    issue(ctx, 'Lease exceeds its claim authority');
  if (
    call &&
    (call.tokenDigest !== lease.tokenDigest ||
      call.model !== lease.model ||
      at(call.dispatchedAt) < at(lease.claimedAt))
  )
    issue(ctx, 'Lease and dispatch authority disagree');
  const possible = (state.historical?.claimedAttempts ?? 0) + calls.length;
  if (!call && possible >= analysisWorkBounds.paidCalls)
    issue(ctx, 'An undispatched lease requires remaining call capacity');
}
function validateCapacity(state: AnalysisWork, ctx: z.RefinementCtx) {
  const facts = analysisRequest(state);
  if (!facts) return;
  const possible =
    (state.historical?.claimedAttempts ?? 0) + facts.calls.length;
  if (possible > analysisWorkBounds.paidCalls)
    issue(ctx, 'Requested work exceeds the seat call budget');
  if (
    state.kind === 'queued' &&
    (possible >= analysisWorkBounds.paidCalls ||
      facts.claims >= analysisWorkBounds.leaseClaims)
  )
    issue(ctx, 'Queued work requires remaining capacity');
  if (state.kind === 'leased') validateLease(state, ctx);
}
function validateHistory(state: AnalysisWork, ctx: z.RefinementCtx) {
  const history = state.historical;
  if (history?.completedAt && at(history.completedAt) < at(history.createdAt))
    issue(ctx, 'Historical completion cannot precede creation');
  if (state.kind === 'unrequested' && history?.completedAt)
    issue(ctx, 'Historical terminal work cannot become unrequested');
  if (
    (state.kind === 'retained' || state.kind === 'retired') &&
    !history?.completedAt
  )
    issue(ctx, 'Historical terminal work requires its original completion');
  if (state.kind !== 'purged') return;
  if (!history && !state.request)
    issue(ctx, 'Purge preserves an existing identity');
  const times = [
    history?.createdAt,
    history?.completedAt,
    state.completedAt,
    state.request?.requestedAt,
    ...(state.request?.calls.map((c) => c.dispatchedAt) ?? []),
  ];
  if (times.some((time) => time && at(time) > at(state.purgedAt)))
    issue(ctx, 'Purge cannot precede preserved work');
}
export const analysisWorkSchema = work.superRefine((state, ctx) => {
  validateHistory(state, ctx);
  validateRequest(state, ctx);
  validateCapacity(state, ctx);
});
