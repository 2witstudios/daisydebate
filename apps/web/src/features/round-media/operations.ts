import { admitsPrincipalAccess } from '@daisy/auth/authorization';
import { createAppError, isAppError } from '@daisy/errors';
import {
  roundMediaAdmissionSchema,
  type RoundMediaState,
} from '@daisy/protocol';
import {
  admissionRevoked,
  mediaEnded,
  mediaRuntime,
  projectMedia,
  seatGrants,
} from './projection';
import { listenIdentity } from './listen-identity';
import { cancelMediaWork } from './cancel-media-work';
import { createMediaReconcileRun } from './reconcile-run';
import type {
  Store,
  Principal,
  Scope,
  MediaOperationInput,
} from './operation-context';
/** The locked context the store signs an admission token against. */
type AdmissionContext = Parameters<
  Parameters<Store['issueMediaToken']>[0]['sign']
>[0];
/** A human caller and the participant-access rule its fenced facts must meet (ADR 0075). */
const callerOf = (actorId: string) => ({
  actorId,
  admits: admitsPrincipalAccess,
});
/**
 * How long a browser admission waits to win the session's lease, below the
 * client's 10 s request deadline. It bounds the wait only: a pass won late can
 * outlast that deadline, and its client then retries while the pass finishes.
 */
export const MEDIA_ADMISSION_WAIT_MS = 8_000;
const MEDIA_DEFERRED = 'media-deferred';
/** Expected backpressure: a retryable 503 that needs no one to look. */
const mediaDeferred = (cause?: unknown) =>
  createAppError('INFRASTRUCTURE', MEDIA_DEFERRED, cause);
export const isMediaDeferred = (error: unknown) =>
  isAppError(error) && error.message === MEDIA_DEFERRED;
/** One read waiting until a pass has served its own version. */
type ServeWaiter = {
  readonly version: number;
  readonly served: ReturnType<typeof Promise.withResolvers<void>>;
};
type AdmissionLimit = {
  readonly untilMs: number;
  /** The client's request: an abandoned admission stops waiting. */
  readonly signal?: AbortSignal;
};
/** Shared production vendor/session consumer. No provider I/O occurs in a database callback. */
export function createRoundMediaOperations(input: MediaOperationInput) {
  const buildProjection: Parameters<
    Store['readMediaSession']
  >[0]['buildProjection'] = (context) =>
    mediaRuntime(context, input.nextId).tick(context.now);
  const snapshot = async (roundId: string, actorId?: string) => {
    const state = await input.store.readMediaSession({
      roundId,
      admits: admitsPrincipalAccess,
      ...(actorId ? { actorId } : {}),
      buildProjection,
    });
    if (!state) throw createAppError('NOT_FOUND');
    return state;
  };
  const run = createMediaReconcileRun(input, buildProjection, snapshot);
  /** The reads each session's one polling loop is still serving. */
  const polls = new Map<string, Set<ServeWaiter>>();
  const acquire = async (sessionId: string, limit?: AdmissionLimit) => {
    const owner = input.nextId();
    await input.priority(sessionId, 'enter', owner);
    try {
      for (;;) {
        if (limit?.signal?.aborted || (limit && input.now() >= limit.untilMs))
          throw mediaDeferred();
        const claim = await input.store.claimMediaReconcile({
          sessionId,
          owner,
        });
        if (claim.kind === 'claimed') return claim;
        await input.wait();
        await input.priority(sessionId, 'enter', owner);
      }
    } finally {
      await input.priority(sessionId, 'leave', owner);
    }
  };
  const pollServed = async (sessionId: string, waiters: Set<ServeWaiter>) => {
    try {
      for (;;) {
        if (waiters.size === 0) return;
        const { servedVersion } =
          await input.store.mediaReconcileProgress(sessionId);
        for (const waiter of waiters)
          if (servedVersion >= waiter.version) {
            waiters.delete(waiter);
            waiter.served.resolve();
          }
        if (waiters.size === 0) return;
        if (await input.priority(sessionId, 'waiting')) {
          await input.wait();
          continue;
        }
        const claim = await input.store.claimMediaReconcile({
          sessionId,
          owner: input.nextId(),
        });
        if (claim.kind === 'claimed') await run(claim);
        else await input.wait();
      }
    } catch (error) {
      // Readers get only the deferral, so the tracker must get the fault. A pass
      // that reported its own failure may repeat here; it is one exception.
      input.reporter.capture(error, {
        requestId: input.nextId(),
        route: '/api/rounds/:id/media/reconcile',
        errorCode: 'INFRASTRUCTURE',
      });
      // A pass's failure says nothing about these readers' access: they retry.
      for (const waiter of waiters) waiter.served.reject(mediaDeferred(error));
    } finally {
      // In the same step as the exit, so no later read can join a finished loop.
      polls.delete(sessionId);
    }
  };
  /** One polling loop per session here, however many reads are waiting on it. */
  const serve = async (
    sessionId: string,
    version: number,
    signal?: AbortSignal,
  ) => {
    const waiter: ServeWaiter = {
      version,
      served: Promise.withResolvers<void>(),
    };
    const existing = polls.get(sessionId);
    const waiters = existing ?? new Set<ServeWaiter>();
    waiters.add(waiter);
    if (!existing) {
      polls.set(sessionId, waiters);
      void pollServed(sessionId, waiters);
    }
    try {
      await (signal
        ? cancelMediaWork(signal, () => waiter.served.promise)
        : waiter.served.promise);
    } finally {
      waiters.delete(waiter);
    }
  };
  const answer = async (
    state: Awaited<ReturnType<typeof snapshot>>,
  ): Promise<RoundMediaState> => {
    const exists =
      !mediaEnded(state) &&
      (await input
        .deadline(input.media.exists(state.session.roomName))
        .catch((error: unknown) => {
          throw createAppError('INFRASTRUCTURE', undefined, error);
        }));
    return projectMedia(state, exists, input.nextId);
  };
  const read = async (roundId: string, actorId?: string) =>
    answer(await snapshot(roundId, actorId));
  const reconcile = async (
    roundId: string,
    actorId?: string,
    signal?: AbortSignal,
  ): Promise<RoundMediaState> => {
    // Before the round lock: a read already abandoned should cost nothing.
    if (signal?.aborted) throw mediaDeferred();
    const request = await input.store.requestMediaReconcile({
      roundId,
      ...(actorId ? { caller: callerOf(actorId) } : {}),
    });
    await serve(request.sessionId, request.version, signal);
    const state = await snapshot(roundId, actorId);
    // A pass's vendor write in flight says nothing about this caller's access.
    if (
      actorId &&
      state.unresolved &&
      !mediaEnded(state) &&
      !admissionRevoked(state)
    )
      throw mediaDeferred();
    // The same snapshot, so a write beginning after this check cannot refuse.
    return answer(state);
  };
  /**
   * `listen` (ISSUE-764) signs the bot seat's own listen-only identity: a
   * hidden identity that subscribes and cannot publish or send data, bound
   * to no seat, so reconciliation never grants it a floor. It is derived
   * from the seat's binding, so a takeover's or a rejoin's listener evicts
   * any earlier connection under it (LiveKit admits one connection per
   * identity). Its claim and live segment are checked under the claim's
   * locks (`verifyBotMediaPrincipal`), and the projected hearing seats
   * (`mediaHearingSeats`, checked in `sign`) decide whether the seat may
   * hear, under this session's reconcile hold. It needs no speaking window:
   * the bot hears most while it does not hold the floor.
   */
  const admit = async (
    roundId: string,
    principal: Principal,
    limit?: AdmissionLimit,
  ) => {
    const hearing = principal.kind === 'bot' && principal.hearing === true;
    const binding =
      principal.kind === 'human'
        ? await input.store.ensureBinding({
            roundId,
            caller: callerOf(principal.actorId),
            buildProjection,
          })
        : await input.store.ensureBotBinding({ principal, buildProjection });
    const sign = async (context: AdmissionContext) => {
      // Post-lock PostgreSQL eligibility, not the earlier unlocked read.
      if (admissionRevoked(context))
        throw createAppError('CONFLICT', 'Round media admission is closed');
      // A hearing grant rests on the projected hearing seats, the same fact
      // room creation reads: base eligibility, a live claim, a live segment.
      if (hearing && !context.hearing.includes(context.participantId))
        throw createAppError('AUTHORIZATION');
      const grants = seatGrants(context, context.participantId, input.nextId);
      const identity = hearing
        ? listenIdentity(context.binding.identity)
        : context.binding.identity;
      const token = await input.media.joinToken(
        hearing
          ? {
              room: context.binding.roomName,
              identity,
              publish: [],
              subscribe: true,
              hidden: true,
              capture: false,
            }
          : {
              room: context.binding.roomName,
              identity,
              ...grants,
              publish: [...grants.publish],
              ...(principal.kind === 'bot' ? { subscribe: false } : {}),
            },
      );
      const own = {
        ...context,
        caller: context.participants.find(
          (seat) => seat.id === context.participantId,
        )!,
      };
      return {
        ...projectMedia(own, true, input.nextId),
        state: 'ready' as const,
        identity,
        token,
        url: principal.kind === 'bot' ? input.workerUrl : input.publicUrl,
        expiresAt: new Date(Date.parse(context.now) + 60_000).toISOString(),
        sessionId: context.session.id,
        roomName: context.binding.roomName,
      };
    };
    let claim = await acquire(binding.sessionId, limit);
    const held: { issued?: Awaited<ReturnType<typeof sign>> } = {};
    // The token is issued while this reconcile still holds the session, so a
    // concurrent reconcile (recovery, another caller) is never live in
    // between to refuse it (ISSUE-534).
    const issue = async () => {
      const state = await snapshot(roundId);
      if (admissionRevoked(state))
        throw createAppError('CONFLICT', 'Round media admission is closed');
      if (
        state.session.unsafeAt ||
        state.unresolved ||
        !(await input.deadline(input.media.exists(state.session.roomName)))
      )
        throw createAppError('INFRASTRUCTURE');
      held.issued = await input.store.issueMediaToken({
        roundId,
        principal,
        admits: admitsPrincipalAccess,
        reconcileOwner: claim.fence.owner,
        buildProjection,
        sign,
      });
    };
    let refusal = await run(claim, principal, issue);
    // Rotation releases the old claim. Reacquire the new room before creating
    // or signing; an unresolved cleanup never earns a retry.
    if (
      !held.issued &&
      (await snapshot(roundId)).session.roomName !== claim.roomName
    ) {
      claim = await acquire(binding.sessionId, limit);
      refusal = await run(claim, principal, issue);
    }
    if (held.issued) return held.issued;
    throw await notIssued(roundId, principal, refusal);
  };
  /**
   * Why the reconcile never reached the issue: a human caller revoked
   * meanwhile is refused as such (read as that caller); otherwise the
   * admission's own refusal the reconcile met; otherwise a race or a
   * cleanup, which is infrastructure and retried.
   */
  const notIssued = async (
    roundId: string,
    principal: Principal,
    refusal: unknown,
  ) => {
    const after = await snapshot(
      roundId,
      principal.kind === 'human' ? principal.actorId : undefined,
    );
    if (admissionRevoked(after))
      return createAppError('CONFLICT', 'Round media admission is closed');
    return refusal ?? createAppError('INFRASTRUCTURE');
  };
  /**
   * Runs `work` while this caller's own reconcile holds the session, so a
   * concurrent reconcile (recovery, a browser) is never live in between to
   * refuse it (ISSUE-551). It never creates a missing room. `null` when the
   * reconcile refused or cleaned up and never reached `work`.
   */
  const holdForCapture = async <T>(
    sessionId: string,
    work: () => Promise<T>,
  ) => {
    const claim = await acquire(sessionId);
    const held: { done?: { readonly value: T } } = {};
    await run(claim, undefined, async () => {
      held.done = { value: await work() };
    });
    return held.done ?? null;
  };
  return {
    read,
    holdForCapture,
    async session(roundId: string, actorId: string, signal?: AbortSignal) {
      // Before the round lock: an admission already abandoned should cost nothing.
      if (signal?.aborted) throw mediaDeferred();
      const response = await admit(
        roundId,
        { kind: 'human', actorId },
        {
          untilMs: input.now() + MEDIA_ADMISSION_WAIT_MS,
          ...(signal ? { signal } : {}),
        },
      );
      return roundMediaAdmissionSchema.parse({
        version: response.version,
        roundId: response.roundId,
        state: response.state,
        grants: response.grants,
        peers: response.peers,
        identity: response.identity,
        token: response.token,
        url: response.url,
        expiresAt: response.expiresAt,
      });
    },
    botToken: (scope: Scope, token: string) =>
      admit(scope.roundId, { kind: 'bot', scope, token }),
    /** The bot seat's own hearing in cross-examination (ISSUE-764). */
    botListenToken: (scope: Scope, token: string) =>
      admit(scope.roundId, { kind: 'bot', scope, token, hearing: true }),
    /**
     * The session's current seat bindings, for a listener whose peer bound
     * after it joined: a read, never a signed grant. An ended session has none.
     */
    async botPeers(scope: Scope) {
      const state = await snapshot(scope.roundId);
      return state.session.endedAt
        ? []
        : state.bindings.map((binding) => ({
            participantId: binding.roundParticipantId,
            identity: binding.identity,
          }));
    },
    reconcile,
    async recoverActiveSessions() {
      const sweepAt = Date.now();
      const passes: { r: string; at: number; ms: number; ok: boolean }[] = [];
      const sessions = await input.store.activeMediaSessions();
      for (const session of sessions) {
        const at = Date.now();
        let ok = true;
        try {
          await reconcile(session.roundId);
        } catch (error) {
          ok = false;
          input.reporter.capture(error, {
            requestId: input.nextId(),
            route: '/api/rounds/:id/media/reconcile',
            errorCode: 'INFRASTRUCTURE',
          });
        }
        passes.push({
          r: session.roundId.slice(0, 8),
          at,
          ms: Date.now() - at,
          ok,
        });
      }
      // TEMPORARY ISSUE-972 diagnostic: dropped before the PR is ready.
      console.log(
        JSON.stringify({
          event: 'temp.recovery.sweep',
          at: sweepAt,
          sessions: sessions.length,
          durationMs: Date.now() - sweepAt,
          passes,
        }),
      );
    },
  };
}
