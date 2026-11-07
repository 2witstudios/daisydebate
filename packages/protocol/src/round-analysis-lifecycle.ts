import type { RoundAnalysisReport } from './round-analysis';
import {
  analysisRequest,
  analysisWorkBounds,
  analysisWorkSchema,
  type AnalysisCall,
  type AnalysisLease,
  type AnalysisWork,
  type RequestedAnalysis,
} from './round-analysis-work';

type Outcome = AnalysisCall['outcome'];
export type AnalysisWorkEvent =
  | {
      readonly kind: 'request';
      readonly requestId: string;
      readonly evidenceLines: number;
    }
  | { readonly kind: 'claim'; readonly lease: Omit<AnalysisLease, 'claimedAt'> }
  | {
      readonly kind: 'dispatch';
      readonly callId: string;
      readonly tokenDigest: string;
    }
  | {
      readonly kind: 'observe';
      readonly callId: string;
      readonly tokenDigest: string;
      readonly outcome: Exclude<Outcome, { kind: 'unknown' }>;
    }
  | {
      readonly kind: 'publish';
      readonly callId: string;
      readonly tokenDigest: string;
      readonly report: RoundAnalysisReport;
    }
  | {
      readonly kind: 'retry';
      readonly callId: string;
      readonly tokenDigest: string;
    }
  | { readonly kind: 'close'; readonly reason: 'authority' | 'evidence' }
  | { readonly kind: 'purge' };
type AnalysisWorkTransition =
  | { readonly kind: 'refuse' | 'unchanged' }
  | { readonly kind: 'changed'; readonly state: AnalysisWork };
type Context = {
  readonly now: string;
  readonly authorized: boolean;
  readonly evidenceAvailable: boolean;
};
const refuse = { kind: 'refuse' } as const;
const unchanged = { kind: 'unchanged' } as const;
const changed = (state: AnalysisWork): AnalysisWorkTransition => {
  const parsed = analysisWorkSchema.safeParse(state);
  return parsed.success ? { kind: 'changed', state: parsed.data } : refuse;
};
const at = (value: string) => Date.parse(value);
const requested = (state: AnalysisWork): state is RequestedAnalysis =>
  'requestedAt' in state;
const active = (
  state: AnalysisWork,
): state is Extract<AnalysisWork, { kind: 'queued' | 'leased' }> =>
  state.kind === 'queued' || state.kind === 'leased';

/** Prior possible automatic calls reduce capacity without inventing counted usage. */
export const remainingAnalysisCalls = (state: AnalysisWork | null): number =>
  state && !['unrequested', 'queued', 'leased'].includes(state.kind)
    ? 0
    : Math.max(
        0,
        analysisWorkBounds.paidCalls -
          (state?.historical?.claimedAttempts ?? 0) -
          (state && 'calls' in state ? state.calls.length : 0),
      );

function payload(state: RequestedAnalysis) {
  const {
    requestId,
    requestedAt,
    deadlineAt,
    evidenceLines,
    historical,
    claims,
    calls,
  } = state;
  return {
    requestId,
    requestedAt,
    deadlineAt,
    evidenceLines,
    historical,
    claims,
    calls,
  };
}
const currentLease = (
  state: AnalysisWork,
  callId: string,
  tokenDigest: string,
  context: Context,
) =>
  state.kind === 'leased' &&
  state.lease.callId === callId &&
  state.lease.tokenDigest === tokenDigest &&
  at(context.now) >= at(state.lease.claimedAt) &&
  at(context.now) < at(state.lease.expiresAt) &&
  at(context.now) < at(state.deadlineAt);
const canContinue = (state: RequestedAnalysis) =>
  remainingAnalysisCalls(state) > 0 &&
  state.claims < analysisWorkBounds.leaseClaims;
const ready = (context: Context) =>
  context.authorized && context.evidenceAvailable;
const failed = (
  state: RequestedAnalysis,
  reason: 'exhausted' | 'authority' | 'evidence' | 'expired',
  now: string,
) => changed({ kind: 'failed', ...payload(state), reason, completedAt: now });

function observe(
  state: AnalysisWork,
  event: Extract<AnalysisWorkEvent, { kind: 'observe' }>,
) {
  if (!requested(state) && state.kind !== 'purged') return refuse;
  const facts = analysisRequest(state);
  if (!facts) return refuse;
  const call = facts.calls.find((c) => c.id === event.callId);
  if (!call || call.tokenDigest !== event.tokenDigest) return refuse;
  if (call.outcome.kind !== 'unknown')
    return sameOutcome(call.outcome, event.outcome) ? unchanged : refuse;
  const calls = facts.calls.map((c) =>
    c.id === call.id ? { ...c, outcome: event.outcome } : c,
  );
  return changed(
    state.kind === 'purged'
      ? { ...state, request: { ...facts, calls } }
      : { ...state, calls },
  );
}
function sameOutcome(left: Outcome, right: Outcome): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind !== 'received' || right.kind !== 'received') return true;
  return (
    left.inputTokens === right.inputTokens &&
    left.outputTokens === right.outputTokens
  );
}

function claim(
  state: RequestedAnalysis,
  lease: Omit<AnalysisLease, 'claimedAt'>,
  context: Context,
) {
  if (!active(state)) return refuse;
  if (at(context.now) >= at(state.deadlineAt))
    return failed(state, 'expired', context.now);
  if (state.kind === 'leased' && at(context.now) < at(state.lease.expiresAt))
    return refuse;
  if (!ready(context))
    return failed(
      state,
      context.authorized ? 'evidence' : 'authority',
      context.now,
    );
  if (!canContinue(state)) return failed(state, 'exhausted', context.now);
  if (
    !(at(lease.expiresAt) > at(context.now)) ||
    at(lease.expiresAt) - at(context.now) > analysisWorkBounds.leaseMs ||
    at(lease.expiresAt) > at(state.deadlineAt) ||
    state.calls.some(
      (c) => c.id === lease.callId || c.tokenDigest === lease.tokenDigest,
    ) ||
    (state.kind === 'leased' &&
      (state.lease.callId === lease.callId ||
        state.lease.tokenDigest === lease.tokenDigest))
  )
    return refuse;
  return changed({
    kind: 'leased',
    ...payload(state),
    claims: state.claims + 1,
    lease: { ...lease, claimedAt: context.now },
  });
}
function dispatch(
  state: RequestedAnalysis,
  event: Extract<AnalysisWorkEvent, { kind: 'dispatch' }>,
  context: Context,
) {
  if (
    state.kind !== 'leased' ||
    !ready(context) ||
    !currentLease(state, event.callId, event.tokenDigest, context)
  )
    return refuse;
  if (state.calls.some((c) => c.id === event.callId)) return unchanged;
  if (remainingAnalysisCalls(state) === 0) return refuse;
  return changed({
    ...state,
    calls: [
      ...state.calls,
      {
        id: event.callId,
        tokenDigest: state.lease.tokenDigest,
        model: state.lease.model,
        dispatchedAt: context.now,
        outcome: { kind: 'unknown' },
      },
    ],
  });
}

function requestWork(
  state: AnalysisWork | null,
  event: Extract<AnalysisWorkEvent, { kind: 'request' }>,
  context: Context,
) {
  if (!context.authorized) return refuse;
  if (state && state.kind !== 'unrequested') return unchanged;
  if (!context.evidenceAvailable || remainingAnalysisCalls(state) === 0)
    return refuse;
  const deadline = new Date(at(context.now) + analysisWorkBounds.requestMs);
  if (!Number.isFinite(deadline.getTime())) return refuse;
  return changed({
    kind: 'queued',
    requestId: event.requestId,
    evidenceLines: event.evidenceLines,
    requestedAt: context.now,
    deadlineAt: deadline.toISOString(),
    historical: state?.historical ?? null,
    claims: 0,
    calls: [],
  });
}
function purge(state: AnalysisWork, now: string) {
  if (state.kind === 'purged') return unchanged;
  const facts = analysisRequest(state);
  const request = facts
    ? {
        requestId: facts.requestId,
        requestedAt: facts.requestedAt,
        deadlineAt: facts.deadlineAt,
        evidenceLines: facts.evidenceLines,
        claims: facts.claims,
        calls: facts.calls,
      }
    : null;
  return changed({
    kind: 'purged',
    historical: state.historical,
    request,
    completedAt: 'completedAt' in state ? state.completedAt : null,
    purgedAt: now,
  });
}
function validTime(state: AnalysisWork | null, now: string) {
  const instant = at(now);
  if (!Number.isFinite(instant)) return false;
  if (!state) return true;
  const facts = analysisRequest(state);
  const times = [
    state.historical?.createdAt,
    state.historical?.completedAt,
    facts?.requestedAt,
    ...(facts?.calls.map((c) => c.dispatchedAt) ?? []),
    'completedAt' in state ? state.completedAt : null,
    state.kind === 'purged' ? state.purgedAt : null,
    state.kind === 'leased' ? state.lease.claimedAt : null,
  ];
  return times.every((time) => !time || instant >= at(time));
}
function publish(
  state: RequestedAnalysis,
  event: Extract<AnalysisWorkEvent, { kind: 'publish' }>,
  context: Context,
) {
  if (
    !ready(context) ||
    !currentLease(state, event.callId, event.tokenDigest, context) ||
    !state.calls.some(
      (c) => c.id === event.callId && c.outcome.kind === 'received',
    )
  )
    return refuse;
  return changed({
    kind: 'succeeded',
    ...payload(state),
    report: event.report,
    completedAt: context.now,
  });
}
function retry(
  state: RequestedAnalysis,
  event: Extract<AnalysisWorkEvent, { kind: 'retry' }>,
  context: Context,
) {
  if (!currentLease(state, event.callId, event.tokenDigest, context))
    return refuse;
  if (!ready(context))
    return failed(
      state,
      context.authorized ? 'evidence' : 'authority',
      context.now,
    );
  return canContinue(state)
    ? changed({ kind: 'queued', ...payload(state) })
    : failed(state, 'exhausted', context.now);
}
/** Effects are owned by adapters; only a changed dispatch permits one provider invocation. */
export function advanceAnalysisWork(
  state: AnalysisWork | null,
  event: AnalysisWorkEvent,
  context: Context,
): AnalysisWorkTransition {
  if (!validTime(state, context.now)) return refuse;
  if (event.kind === 'request') return requestWork(state, event, context);
  if (!state) return refuse;
  if (event.kind === 'purge') return purge(state, context.now);
  if (event.kind === 'observe') return observe(state, event);
  if (!requested(state)) return refuse;
  switch (event.kind) {
    case 'claim':
      return claim(state, event.lease, context);
    case 'dispatch':
      return dispatch(state, event, context);
    case 'close':
      return active(state)
        ? failed(state, event.reason, context.now)
        : unchanged;
    case 'publish':
      return publish(state, event, context);
    case 'retry':
      return retry(state, event, context);
  }
}

/** Settle only requested dispatches; old uncertain exposure is never a new debit or relief. */
export function analysisUsageOutcome(
  state: AnalysisWork,
): 'pending' | 'unspent' | 'unknown' | 'delivered' | 'definite_failure' {
  if (active(state)) return 'pending';
  const calls = analysisRequest(state)?.calls ?? [];
  if (calls.length === 0) return 'unspent';
  if (calls.some((call) => call.outcome.kind === 'unknown')) return 'unknown';
  return calls.some((call) => call.outcome.kind === 'received')
    ? 'delivered'
    : 'definite_failure';
}
