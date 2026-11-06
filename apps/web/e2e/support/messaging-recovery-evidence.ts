import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page, Request, Response } from '@playwright/test';
import { systemClock } from '@daisy/clock';
import { createRecoveryRequestEvents } from './messaging-recovery-events';
import { isMessagingRefetch } from './messaging-page-locators';

/** All real RSC reads, including successor routes; explicit speculation stays separate. */
export function watchConversationRecovery(page: Page, channelId: string) {
  const lifecycle = createRecoveryRequestEvents(() =>
    Date.parse(systemClock.now()),
  );
  const pending = new Set<Request>();
  const responseIds = new Set<string>();
  const refetchResponses: Response[] = [];
  const phases: { name: string; since: number }[] = [];
  const reads: { phase: string; destination: 'original' | 'successor' }[] = [];
  let prefetches = 0,
    maximumPending = 0,
    memberChoices = 0,
    historyGetRequests = 0;
  const phase = (name: string) => {
    phases.push({ name, since: Date.parse(systemClock.now()) });
  };
  phase('initial refusal');
  const request = (incoming: Request) => {
    if (
      incoming.method() === 'GET' &&
      new URL(incoming.url()).pathname ===
        `/api/messaging/channels/${channelId}/messages`
    )
      historyGetRequests += 1;
    const headers = incoming.headers();
    if (headers['next-router-prefetch'] === '1') {
      prefetches += 1;
      return;
    }
    if (!isMessagingRefetch(headers)) return;
    reads.push({
      phase: phases.at(-1)!.name,
      destination:
        new URL(incoming.url()).pathname === `/messages/${channelId}`
          ? 'original'
          : 'successor',
    });
    pending.add(incoming);
    lifecycle.request(incoming);
    maximumPending = Math.max(maximumPending, pending.size);
  };
  const settled = (incoming: Request) => {
    pending.delete(incoming);
  };
  const includeResponse = (id: string | undefined) => {
    if (!id) throw new Error('Messaging response correlation missing');
    responseIds.add(id);
  };
  const finished = (incoming: Request) => {
    settled(incoming);
    lifecycle.finished(incoming);
  };
  const failed = (incoming: Request) => {
    settled(incoming);
    lifecycle.failed(incoming, incoming.failure()?.errorText ?? null);
  };
  const response = (incoming: Response) => {
    lifecycle.response(incoming);
    const outgoing = incoming.request();
    if (
      new URL(outgoing.url()).pathname === `/messages/${channelId}` &&
      outgoing.headers()['next-router-prefetch'] !== '1' &&
      (outgoing.isNavigationRequest() || isMessagingRefetch(outgoing.headers()))
    ) {
      includeResponse(incoming.headers()['x-request-id']);
      if (outgoing.method() === 'GET' && isMessagingRefetch(outgoing.headers()))
        refetchResponses.push(incoming);
    }
  };
  page.on('response', response);
  page.on('request', request);
  page.on('requestfinished', finished);
  page.on('requestfailed', failed);
  return {
    phase,
    memberNavigation: () => {
      memberChoices += 1;
    },
    phases: () => phases,
    includeResponse,
    refetchResponses: () => refetchResponses,
    eventStep: lifecycle.step,
    selectedRequestEvents: lifecycle.snapshot,
    requestBoundary: () => ({
      since: phases[0]!.since,
      requestIds: [...responseIds],
    }),
    snapshot: () => ({
      dispatches: reads.filter((read) => read.destination === 'original')
        .length,
      otherDispatches: reads.filter((read) => read.destination === 'successor')
        .length,
      memberChoices,
      historyGetRequests,
      provenance: 'observed; no request attributed from choice alone',
      prefetches,
      maximumPending,
      pending: pending.size,
      reads,
    }),
    stop: () => {
      page.off('response', response);
      page.off('request', request);
      page.off('requestfinished', finished);
      page.off('requestfailed', failed);
    },
  };
}

export const readMessagingAdmissionLog = () =>
  readFile(
    resolve(
      import.meta.dirname,
      `../../test-results/server-${process.env.E2E_PORT}.log`,
    ),
    'utf8',
  );

/** Safe operation/phase counts, all protected HTTP fanout and interval overlap. */
export async function messagingAdmissionEvidence(
  phases: readonly { name: string; since: number }[],
) {
  const source = await readMessagingAdmissionLog();
  const lines: Record<string, unknown>[] = source
    .split('\n')
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    })
    .filter(
      (line) =>
        typeof line['time'] === 'number' && line['time'] >= phases[0]!.since,
    );
  const summaries = lines.filter(
    (line) => line['event'] === 'db.capacity.refused',
  );
  const operations: Record<
    string,
    {
      startPhase: string;
      finishPhase: string;
      operation: string;
      count: number;
    }
  > = {};
  const intervals: { at: number; delta: number }[] = [];
  const completed = lines.filter(
    (line) =>
      typeof line['operation'] === 'string' &&
      ['http.request.completed', 'http.request.failed'].includes(
        String(line['event']),
      ),
  );
  for (const line of completed) {
    const time = Number(line['time']);
    const start = time - Number(line['durationMs']);
    const startPhase =
      [...phases].reverse().find((phase) => phase.since <= start)?.name ??
      'before observation';
    const finishPhase = [...phases]
      .reverse()
      .find((phase) => phase.since <= time)!.name;
    const operation = String(line['operation']);
    const key = JSON.stringify([startPhase, finishPhase, operation]);
    const count = (operations[key] ??= {
      startPhase,
      finishPhase,
      operation,
      count: 0,
    });
    count.count += 1;
    intervals.push(
      { at: time - Number(line['durationMs']), delta: 1 },
      { at: time, delta: -1 },
    );
  }
  let active = 0,
    maximumConcurrent = 0;
  for (const interval of intervals.sort(
    (a, b) => a.at - b.at || a.delta - b.delta,
  )) {
    active += interval.delta;
    maximumConcurrent = Math.max(maximumConcurrent, active);
  }
  return {
    operations: Object.values(operations),
    maximumConcurrentWholeObservation: maximumConcurrent,
    failures: completed
      .filter((line) => line['event'] === 'http.request.failed')
      .map((failure) => ({
        operation: failure['operation'],
        status: failure['status'],
        errorCode: failure['errorCode'],
        durationMs: failure['durationMs'],
        admission:
          summaries.find(
            (summary) => summary['requestId'] === failure['requestId'],
          )?.['cause'] ?? null,
      })),
  };
}
