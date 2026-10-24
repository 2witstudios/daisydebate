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
/** Shared production vendor/session consumer. No provider I/O occurs in a database callback. */
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
  const admit = async (roundId: string, principal: Principal) => {
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
    const sign = async (context: AdmissionContext) => {
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
    };
    const claim = await acquire(binding.sessionId);
    const held: { issued?: Awaited<ReturnType<typeof sign>> } = {};
    // The token is issued while this reconcile still holds the session, so a
    // concurrent reconcile (recovery, another caller) is never live in
    // between to refuse it (ISSUE-534).
    await run(claim, principal, async () => {
      const state = await snapshot(roundId);
      if (admissionRevoked(state))
        throw createAppError('CONFLICT', 'Round media admission is closed');
      if (
        state.session.unsafeAt ||
        state.unresolved ||
        !(await input.deadline(input.media.exists(binding.roomName)))
      )
        throw createAppError('INFRASTRUCTURE');
      held.issued = await input.store.issueMediaToken({
        roundId,
        principal,
        reconcileOwner: claim.fence.owner,
        buildProjection,
        sign,
      });
    });
    if (held.issued) return held.issued;
    // The reconcile refused or cleaned up and never reached the issue.
    if (admissionRevoked(await snapshot(roundId)))
      throw createAppError('CONFLICT', 'Round media admission is closed');
    throw createAppError('INFRASTRUCTURE');
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
