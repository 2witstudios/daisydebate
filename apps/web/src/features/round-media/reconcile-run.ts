import { createAppError, isAppError } from '@daisy/errors';
import {
  changedMediaGrants,
  type RoundMediaGrants,
} from '@daisy/debate-engine';
import {
  admissionRevoked,
  mediaEnded,
  seatGrants,
  type MediaSnapshot,
} from './projection';
import type {
  Claim,
  Principal,
  Store,
  MediaOperationInput,
} from './operation-context';
import { createMediaMutations } from './mutation';

type KnownPublisher = {
  identity: string;
  participantId: string;
  grants: RoundMediaGrants;
  restricted: boolean;
};
const differs = (
  identity: string,
  current: RoundMediaGrants,
  desired: RoundMediaGrants,
) =>
  changedMediaGrants(
    [{ identity, grants: current }],
    [{ identity, grants: desired }],
  ).length > 0;
const needsCleanup = (state: MediaSnapshot, claim: Claim) =>
  Boolean(
    claim.unsafe ||
    state.session.unsafeAt ||
    state.unresolved ||
    admissionRevoked(state) ||
    mediaEnded(state),
  );
const uncertain = (state: MediaSnapshot) =>
  Boolean(state.session.unsafeAt || state.unresolved);

export function createMediaReconcileRun(
  input: MediaOperationInput,
  buildProjection: Parameters<Store['readMediaSession']>[0]['buildProjection'],
  snapshot: (roundId: string, actorId?: string) => Promise<MediaSnapshot>,
) {
  const { unsafe, mutate } = createMediaMutations(input, buildProjection);
  const removeRoom = async (claim: Claim) => {
    if (await input.deadline(input.media.exists(claim.roomName))) {
      await mutate(
        claim,
        { kind: 'delete', identity: null, payload: {} },
        () => undefined,
      );
    }
    // A pending mutation could apply after an absence read. It must settle BEFORE that read.
    const proof = await input.store.prepareMediaAbsenceProof(claim.fence);
    if (!proof || (await input.deadline(input.media.exists(claim.roomName))))
      return null;
    return proof;
  };
  const createRoom = async (claim: Claim, admission: Principal) => {
    if (admission.kind === 'bot')
      await input.store.ensureBotBinding({
        scope: admission.scope,
        token: admission.token,
        buildProjection,
      });
    return mutate(
      claim,
      { kind: 'create', identity: null, payload: {} },
      (context) => {
        if (mediaEnded(context) || admissionRevoked(context))
          throw createAppError('CONFLICT');
        const seat = context.participants.find((seat) =>
          admission.kind === 'human'
            ? seat.actorId === admission.actorId && seat.kind === 'human'
            : seat.id === admission.scope.roundParticipantId &&
              seat.kind === 'bot',
        );
        // A human revoked after binding is refused here too (ISSUE-714).
        if (!seat?.eligible || context.withdrawn.includes(seat.id))
          throw createAppError('AUTHORIZATION');
      },
    );
  };
  const knownPublishers = async (claim: Claim) => {
    const current = await input.deadline(
      input.media.publicationPermissions(claim.roomName),
    );
    const state = await snapshot(claim.roundId);
    const known = current.flatMap((entry) => {
      const binding = state.bindings.find(
        (binding) => binding.identity === entry.identity,
      );
      return binding
        ? [{ ...entry, participantId: binding.roundParticipantId }]
        : [];
    });
    return { known, state };
  };
  /**
   * Closes against the snapshot the publishers were read with: nothing was
   * written in between, and each close is authorized under its own lock, so
   * a second read would only delay the floor change (ISSUE-572).
   */
  const closeStale = async (
    claim: Claim,
    known: KnownPublisher[],
    state: MediaSnapshot,
  ) => {
    for (const entry of known) {
      const desired = seatGrants(state, entry.participantId, input.nextId);
      if (
        !entry.grants.publish.includes('microphone') ||
        desired.publish.includes('microphone')
      )
        continue;
      const grants = {
        ...desired,
        publish: entry.grants.publish.filter((source) =>
          desired.publish.includes(source),
        ),
        subscribe: entry.grants.subscribe && desired.subscribe,
      };
      const result = await mutate(
        claim,
        {
          kind: 'permissions',
          identity: entry.identity,
          payload: { ...grants, publish: [...grants.publish] },
        },
        () => undefined,
      );
      if (!result.acknowledged) return false;
      entry.grants = grants;
    }
    return true;
  };
  const authorizePermissions =
    (
      known: KnownPublisher[],
      entry: KnownPublisher,
      grants: RoundMediaGrants,
    ) =>
    (
      context: Parameters<
        Parameters<Store['beginMediaMutation']>[0]['authorize']
      >[0],
    ) => {
      const fresh = seatGrants(context, entry.participantId, input.nextId);
      if (differs(entry.identity, fresh, grants))
        throw createAppError('CONFLICT', 'Media authority changed');
      const staleMicrophone = known.some(
        (other) =>
          other.grants.publish.includes('microphone') &&
          !seatGrants(
            context,
            other.participantId,
            input.nextId,
          ).publish.includes('microphone'),
      );
      if (grants.publish.includes('microphone') && staleMicrophone)
        throw createAppError('CONFLICT', 'Microphone closure required');
    };
  const applyPermissions = async (claim: Claim, known: KnownPublisher[]) => {
    // Rehydrate after every stale microphone has closed, before allowing any opening.
    const state = await snapshot(claim.roundId);
    for (const entry of known) {
      const grants = seatGrants(state, entry.participantId, input.nextId);
      if (entry.restricted && !differs(entry.identity, entry.grants, grants))
        continue;
      const result = await mutate(
        claim,
        {
          kind: 'permissions',
          identity: entry.identity,
          payload: { ...grants, publish: [...grants.publish] },
        },
        authorizePermissions(known, entry, grants),
      );
      if (!result.acknowledged) return;
      entry.grants = grants;
    }
  };
  const reconcileRoom = async (claim: Claim, admission?: Principal) => {
    if (!(await input.deadline(input.media.exists(claim.roomName)))) {
      if (!admission) return;
      if (!(await createRoom(claim, admission)).acknowledged) return;
    }
    const { known, state } = await knownPublishers(claim);
    if (await closeStale(claim, known, state))
      await applyPermissions(claim, known);
  };
  /** The caller's step under the lease; its failure is returned, not thrown. */
  const runHeld = async (whileHeld?: () => Promise<void>) => {
    try {
      await whileHeld?.();
      return null;
    } catch (error) {
      return { error };
    }
  };
  /**
   * One reconcile under `claim`. `whileHeld` runs after a successful
   * reconcile and before the lease is released, so no other reconcile can
   * change the session in between (ISSUE-534); its own failure reaches the
   * caller after the release and never marks the session unsafe.
   */
  return async (
    claim: Claim,
    admission?: Principal,
    whileHeld?: () => Promise<void>,
  ) => {
    let absenceProof: Awaited<ReturnType<Store['prepareMediaAbsenceProof']>> =
      null;
    let cleanupAttempted = false;
    let held: { readonly error: unknown } | null = null;
    try {
      const state = await snapshot(claim.roundId);
      if (needsCleanup(state, claim)) {
        cleanupAttempted = true;
        absenceProof = await removeRoom(claim);
      } else {
        await reconcileRoom(claim, admission);
        held = await runHeld(whileHeld);
      }
    } catch (error) {
      if (
        !isAppError(error) ||
        !['CONFLICT', 'AUTHORIZATION'].includes(error.code)
      )
        await unsafe(claim, error);
    } finally {
      try {
        const state = await snapshot(claim.roundId);
        if (!cleanupAttempted && uncertain(state))
          absenceProof = await removeRoom(claim);
      } catch (error) {
        await unsafe(claim, error);
      }
      await input.store.finishMediaReconcile({
        ...claim.fence,
        absenceProof,
      });
    }
    if (held) throw held.error;
  };
}
