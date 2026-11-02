import { createMediaWorkerAuthentication } from '@daisy/media/internal';
import { createMediaWorkerClient } from '@daisy/media/worker';
import type { CaptureClient } from './capture-history';

/** A capture client answering history with `state` and recording each write in `calls`. */
export const recordingCaptureClient = (
  state: unknown,
  calls: string[],
  observed: unknown[] = [],
) =>
  ({
    read: async () => ({ state, calibration: {} }),
    append: async () => {
      calls.push('append');
      return {};
    },
    observe: async (observation: unknown) => {
      calls.push('observe');
      observed.push(observation);
      return {};
    },
  }) as unknown as CaptureClient;

export const captureScope = {
  roundId: 'r'.repeat(24),
  sessionId: 's'.repeat(24),
  workerId: 'w'.repeat(24),
};
type Fetch = (
  url: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
/** The real signed client over a test's network. */
export const signedCaptureClient = (
  fetch: Fetch,
  nowMs: () => number = () => 0,
  scope = captureScope,
) =>
  createMediaWorkerClient({
    scope,
    url: 'http://127.0.0.1/',
    authentication: createMediaWorkerAuthentication({
      secret: Buffer.alloc(32, 6).toString('base64url'),
      now: () => 1000,
    }),
    fetch,
    nowMs,
    deadlineSignal: () => AbortSignal.timeout(3000),
    unavailableRetryMs: [],
  });
/** What the web app answers a token request with. */
export const tokenAnswer = (nowMs: number) =>
  Response.json({
    sessionId: captureScope.sessionId,
    roomName: 'o'.repeat(24),
    identity: 'c'.repeat(24),
    url: 'wss://media.invalid',
    token: 'token',
    expiresAt: new Date(nowMs + 60000).toISOString(),
  });
/** What the web app answers a history read with: one open speech and its seats. */
export const historyAnswer = (input: {
  readonly nowMs: number;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly seats: readonly { readonly id: string; readonly identity: string }[];
}) =>
  Response.json({
    roundId: captureScope.roundId,
    sessionId: captureScope.sessionId,
    version: 1,
    serverNow: new Date(input.nowMs).toISOString(),
    status: 'active',
    transcriptAdmissionCutoff: null,
    participants: input.seats.map((seat) => ({
      roundParticipantId: seat.id,
      kind: 'human',
      identity: seat.identity,
    })),
    segment: {
      id: 'g'.repeat(24),
      sequence: 0,
      type: 'speech',
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      durationMs: 3_600_000,
    },
    intervals: input.seats.map((seat, index) => ({
      id: String(index + 1).repeat(24),
      roundParticipantId: seat.id,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      startedVersion: 1,
      endedVersion: input.endedAt ? 2 : null,
    })),
    nextIntervalId: null,
  });
/** The longest stretch of a stream no logged observation covers. */
export const longestObservationHoleMs = (
  log: readonly {
    readonly op: string;
    readonly body: Record<string, unknown>;
  }[],
) =>
  log
    .filter((entry) => entry.op === 'observe')
    .map(
      (entry) =>
        [
          Date.parse(String(entry.body.observedFrom)),
          Date.parse(String(entry.body.observedUntil)),
        ] as const,
    )
    .sort((a, b) => a[0] - b[0])
    .reduce(
      (hole, span, index, all) =>
        index === 0 ? hole : Math.max(hole, span[0] - all[index - 1]![1]),
      0,
    );
