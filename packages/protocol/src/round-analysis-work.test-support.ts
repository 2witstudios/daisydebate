import type { AnalysisWork } from './round-analysis-work';
import {
  advanceAnalysisWork as advance,
  type AnalysisWorkEvent,
} from './round-analysis-lifecycle';
export const requestId = 'r'.repeat(24);
export const id = (n: number) => `c${String(n).padStart(23, '0')}`;
export const digest = (n: number) => String(n).repeat(64);
export const at = (n: number) =>
  new Date(Date.parse('2026-11-05T00:00:00.000Z') + n * 1000).toISOString();
export const context = (n = 0) => ({
  now: at(n),
  authorized: true,
  evidenceAvailable: true,
});
export const lease = (n: number) => ({
  callId: id(n),
  tokenDigest: digest(n),
  model: 'analysis-model',
  expiresAt: at(n * 30),
});
export function step(
  state: AnalysisWork | null,
  event: AnalysisWorkEvent,
  n = 0,
): AnalysisWork {
  const result = advance(state, event, context(n));
  if (result.kind !== 'changed')
    throw Error(`Expected changed ${event.kind}, got ${result.kind}`);
  return result.state;
}
export const queued = () =>
  step(null, { kind: 'request', evidenceLines: 1, requestId });
export const claimed = () => step(queued(), { kind: 'claim', lease: lease(1) });
export const dispatch = (state: AnalysisWork, n: number, now = 0) =>
  step(state, { kind: 'dispatch', callId: id(n), tokenDigest: digest(n) }, now);
export const received = {
  kind: 'received',
  inputTokens: 100,
  outputTokens: 20,
} as const;
export const failed = { kind: 'definite_failure' } as const;
export const observe = (
  state: AnalysisWork,
  n: number,
  outcome: typeof received | typeof failed,
  now = 0,
) =>
  step(
    state,
    { kind: 'observe', callId: id(n), tokenDigest: digest(n), outcome },
    now,
  );
export const history = {
  createdAt: at(0),
  completedAt: null,
  claimedAttempts: 1,
  model: 'old-analysis-model',
  inputTokens: 150,
  outputTokens: 20,
};
