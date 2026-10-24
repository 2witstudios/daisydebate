import { MEDIA_RECONCILE_PENDING } from '@daisy/db';
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
import { createMediaReconcileRun } from './reconcile-run';
import type {
  Store,
  Principal,
  Scope,
  MediaOperationInput,
} from './operation-context';
/** Shared production vendor/session consumer. No provider I/O occurs in a database callback. */
/** Reconciles one admission may run before a pending refusal reaches the caller. */
const ADMISSION_ATTEMPTS = 3;
const isReconcilePending = (error: unknown) =>
  isAppError(error) &&
  error.code === 'INFRASTRUCTURE' &&
  error.message === MEDIA_RECONCILE_PENDING;

export function createRoundMediaOperations(input: MediaOperationInput) {
  const buildProjection: Parameters<
    Store['readMediaSession']
  >[0]['buildProjection'] = (context) =>
    mediaRuntime(context, input.nextId).tick(context.now);
  const snapshot = async (roundId: string, actorId?: string) => {
    const state = await input.store.readMediaSession({
      roundId,
      ...(actorId ? { actorId } : {}),
      buildProjection,
    });
    if (!state) throw createAppError('NOT_FOUND');
    return state;
  };
  const run = createMediaReconcileRun(input, buildProjection, snapshot);
  const acquire = async (sessionId: string) => {
    const owner = input.nextId();
    for (;;) {
      const claim = await input.store.claimMediaReconcile({ sessionId, owner });
      if (claim.kind === 'claimed') return claim;
      await input.wait();
    }
  };
  const serve = async (sessionId: string, version: number) => {
    for (;;) {
      const progress = await input.store.mediaReconcileProgress(sessionId);
      if (progress.servedVersion >= version) return;
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
      ...(actorId ? { actorId } : {}),
    });
    await serve(request.sessionId, request.version);
    return read(roundId, actorId);
  };
  /** One reconcile, the eligibility checks and the token issue for this caller. */
  const admitOnce = async (roundId: string, principal: Principal) => {
    const binding =
      principal.kind === 'human'
        ? await input.store.ensureBinding({
            roundId,
            actorId: principal.actorId,
            buildProjection,
          })
        : await input.store.ensureBotBinding({
            scope: principal.scope,
            token: principal.token,
            buildProjection,
          });
    const claim = await acquire(binding.sessionId);
    await run(claim, principal);
    const state = await snapshot(roundId);
    if (admissionRevoked(state))
      throw createAppError('CONFLICT', 'Round media admission is closed');
    if (state.unresolved)
      throw createAppError('INFRASTRUCTURE', MEDIA_RECONCILE_PENDING);
    if (
      state.session.unsafeAt ||
      !(await input.deadline(input.media.exists(binding.roomName)))
    )
      throw createAppError('INFRASTRUCTURE');
    return input.store.issueMediaToken({
      roundId,
      principal,
      buildProjection,
      sign: async (context) => {
        // Post-lock PostgreSQL eligibility, not the earlier unlocked read.
        if (admissionRevoked(context))
          throw createAppError('CONFLICT', 'Round media admission is closed');
        const grants = seatGrants(context, context.participantId, input.nextId);
        const token = await input.media.joinToken({
          room: context.binding.roomName,
          identity: context.binding.identity,
          ...grants,
          publish: [...grants.publish],
          ...(principal.kind === 'bot' ? { subscribe: false } : {}),
        });
        const own = {
          ...context,
          caller: context.participants.find(
            (seat) => seat.id === context.participantId,
          )!,
        };
        return {
          ...projectMedia(own, true, input.nextId),
          state: 'ready' as const,
          identity: context.binding.identity,
          token,
          url: principal.kind === 'bot' ? input.workerUrl : input.publicUrl,
          expiresAt: new Date(Date.parse(context.now) + 60_000).toISOString(),
          sessionId: context.session.id,
          roomName: context.binding.roomName,
        };
      },
    });
  };
  /**
   * A token refused only as pending (another reconcile landed between ours
   * and the issue, or a vendor mutation is in flight) reconciles again, up to
   * ADMISSION_ATTEMPTS times, before the caller sees it as unavailable.
   */
  const admit = async (roundId: string, principal: Principal) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await admitOnce(roundId, principal);
      } catch (error) {
        if (attempt >= ADMISSION_ATTEMPTS || !isReconcilePending(error))
          throw error;
      }
    }
  };
  return {
    read,
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
