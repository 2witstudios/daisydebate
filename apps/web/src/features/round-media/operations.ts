import { admitsPrincipalAccess } from '@daisy/auth/authorization';
import { createAppError } from '@daisy/errors';
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
  const acquire = async (sessionId: string) => {
    const owner = input.nextId();
    await input.priority(sessionId, 'enter', owner);
    try {
      for (;;) {
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
  const serve = async (sessionId: string, version: number) => {
    for (;;) {
      const progress = await input.store.mediaReconcileProgress(sessionId);
      if (progress.servedVersion >= version) return;
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
  };
  const read = async (
    roundId: string,
    actorId?: string,
  ): Promise<RoundMediaState> => {
    const state = await snapshot(roundId, actorId);
    const exists =
      !mediaEnded(state) &&
      (await input.deadline(input.media.exists(state.session.roomName)));
    return projectMedia(state, exists, input.nextId);
  };
  const reconcile = async (
    roundId: string,
    actorId?: string,
  ): Promise<RoundMediaState> => {
    const request = await input.store.requestMediaReconcile({
      roundId,
      ...(actorId ? { caller: callerOf(actorId) } : {}),
    });
    await serve(request.sessionId, request.version);
    return read(roundId, actorId);
  };
  /**
   * `listen` (ISSUE-764) signs the bot seat's own listen-only identity: a
   * hidden identity that subscribes and cannot publish or send data, bound
   * to no seat, so reconciliation never grants it a floor. It is derived
   * from the seat's binding, so a takeover's or a rejoin's listener evicts
   * any earlier connection under it (LiveKit admits one connection per
   * identity). It is admitted on the bot's live claim within its live
   * segment and the media window, under this session's reconcile hold, but
   * needs no speaking window: the bot hears most while it does not hold the
   * floor (`verifyBotMediaPrincipal`).
   */
  const admit = async (roundId: string, principal: Principal) => {
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
    let claim = await acquire(binding.sessionId);
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
      claim = await acquire(binding.sessionId);
      refusal = await run(claim, principal, issue);
    }
    if (held.issued) return held.issued;
    throw await notIssued(roundId, principal, refusal);
  };
  /**
   * Why the reconcile never reached the issue: a human caller revoked
   * meanwhile is refused as such (read as that caller); otherwise the
   * refusal the reconcile itself met; otherwise it cleaned up, which is
   * infrastructure.
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
    async session(roundId: string, actorId: string) {
      const response = await admit(roundId, { kind: 'human', actorId });
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
      for (const session of await input.store.activeMediaSessions()) {
        try {
          await reconcile(session.roundId);
        } catch (error) {
          input.reporter.capture(error, {
            requestId: input.nextId(),
            route: '/api/rounds/:id/media/reconcile',
            errorCode: 'INFRASTRUCTURE',
          });
        }
      }
    },
  };
}
