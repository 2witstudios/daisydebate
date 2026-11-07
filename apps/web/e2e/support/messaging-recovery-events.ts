import type { Request, Response } from '@playwright/test';

type Stamp = { readonly at: number; readonly sequence: number };
type Category =
  'not-recorded' | 'aborted' | 'connection' | 'other' | 'unavailable';
type Terminal = Stamp & {
  readonly request: Request;
  readonly pageResponse: Response | null;
};
type Entry = {
  readonly request: Request;
  pageResponse: Response | null;
  finished: Terminal | null;
  failed: Terminal | null;
  finishedCount: number;
  failedCount: number;
  failureCategory: Category;
  countLimitReached: boolean;
};
const category = (text: string | null): Category =>
  text === null
    ? 'unavailable'
    : text === 'net::ERR_ABORTED'
      ? 'aborted'
      : [
            'net::ERR_CONNECTION_CLOSED',
            'net::ERR_CONNECTION_RESET',
            'net::ERR_CONNECTION_REFUSED',
          ].includes(text)
        ? 'connection'
        : 'other';

/** Passive public-event evidence; SDK objects and absolute times never leave the map. */
export function createRecoveryRequestEvents(now: () => number) {
  const records = new Map<Request, Entry>();
  let sequence = 0,
    recordLimitReached = false;
  const stamp = (): Stamp => ({ at: now(), sequence: ++sequence });
  const timing = (event: Terminal | null, step: Stamp, deadline: number) => {
    if (!event)
      return { stage: 'not-observed', offsetMs: null, clipped: false };
    const offset = event.at - step.at;
    return {
      stage:
        event.sequence < step.sequence
          ? 'before-step-entry'
          : event.at > deadline
            ? 'after-step-budget-before-capture'
            : event.at === deadline
              ? 'at-step-deadline-before-capture'
              : 'within-step-budget',
      offsetMs: Math.max(-30000, Math.min(30000, offset)),
      clipped: Math.abs(offset) > 30000,
    };
  };
  const terminal = (
    request: Request,
    kind: 'finished' | 'failed',
    failure: string | null = null,
  ) => {
    const entry = records.get(request);
    if (!entry) return;
    const at = stamp();
    const key = kind === 'finished' ? 'finishedCount' : 'failedCount';
    if (entry[key] >= 4) entry.countLimitReached = true;
    entry[key] = Math.min(4, entry[key] + 1);
    if (entry[kind] === null) {
      entry[kind] = { ...at, request, pageResponse: entry.pageResponse };
      if (kind === 'failed') entry.failureCategory = category(failure);
    }
  };
  return {
    request: (request: Request) => {
      if (records.has(request)) return;
      if (records.size >= 64) {
        recordLimitReached = true;
        return;
      }
      records.set(request, {
        request,
        pageResponse: null,
        finished: null,
        failed: null,
        finishedCount: 0,
        failedCount: 0,
        failureCategory: 'not-recorded',
        countLimitReached: false,
      });
    },
    response: (response: Response) => {
      const entry = records.get(response.request());
      if (entry) entry.pageResponse = response;
    },
    finished: (request: Request) => terminal(request, 'finished'),
    failed: (request: Request, failure: string | null) =>
      terminal(request, 'failed', failure),
    step: stamp,
    snapshot: (selected: Response, step: Stamp, deadline: number) => {
      const captured = stamp();
      const request = selected.request();
      const entry = records.get(request);
      const finished = entry?.finished ?? null,
        failed = entry?.failed ?? null;
      const finishTiming = timing(finished, step, deadline),
        failTiming = timing(failed, step, deadline);
      // Every field is a copied primitive. Late callbacks cannot rewrite a receipt.
      return Object.freeze({
        recordFound: entry !== undefined,
        sameSelectedRequest: entry ? entry.request === request : null,
        pageResponseObserved: entry ? entry.pageResponse !== null : null,
        samePageResponse: entry?.pageResponse
          ? entry.pageResponse === selected
          : null,
        finishedCount: entry?.finishedCount ?? null,
        failedCount: entry?.failedCount ?? null,
        eventKind: !entry
          ? 'not-observed'
          : finished && failed
            ? 'both'
            : finished
              ? 'finished'
              : failed
                ? 'failed'
                : 'none',
        failureCategory: entry?.failureCategory ?? 'not-observed',
        finishedSameRequest: finished ? finished.request === request : null,
        failedSameRequest: failed ? failed.request === request : null,
        finishedPageResponseIsNull: finished
          ? finished.pageResponse === null
          : null,
        failedPageResponseIsNull: failed ? failed.pageResponse === null : null,
        finishedSamePageResponse: finished?.pageResponse
          ? finished.pageResponse === selected
          : null,
        failedSamePageResponse: failed?.pageResponse
          ? failed.pageResponse === selected
          : null,
        finishedStage: finishTiming.stage,
        failedStage: failTiming.stage,
        finishedOffsetMs: finishTiming.offsetMs,
        failedOffsetMs: failTiming.offsetMs,
        finishedTimingClipped: finishTiming.clipped,
        failedTimingClipped: failTiming.clipped,
        captureTimingClipped:
          captured.at - step.at < 0 || captured.at - step.at > 30000,
        captureElapsedMs: Math.max(0, Math.min(30000, captured.at - step.at)),
        recordLimitReached,
        terminalCountLimitReached: entry?.countLimitReached ?? false,
        pageMappingKind: 'public-page-response',
        nativeNullableResponsePayload: 'NOT_CAPTURED',
      });
    },
  };
}
