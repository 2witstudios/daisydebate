import { createAppError, isRefusal } from '@daisy/errors';
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

/** What a vendor mutation's authorization reads, under its locks. */
type AuthorizeContext = Parameters<
  Parameters<Store['beginMediaMutation']>[0]['authorize']
>[0];
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

/**
 * Whether the room's creation admits `admission`'s own seat. A human
 * revoked after binding is refused here too (ISSUE-714). A seat's
 * `eligible` means it may publish; a bot that only hears is admitted by the
 * projected hearing seats instead.
 */
const admitsCreator = (context: AuthorizeContext, admission: Principal) => {
  const seat = context.participants.find((seat) =>
    admission.kind === 'human'
      ? seat.actorId === admission.actorId && seat.kind === 'human'
      : seat.id === admission.scope.roundParticipantId && seat.kind === 'bot',
  );
  if (!seat || context.withdrawn.includes(seat.id)) return false;
  return admission.kind === 'bot' && admission.hearing
    ? context.hearing.includes(seat.id)
    : seat.eligible;
};

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
  /**
   * Creates the room for `admission`, or returns `{ refused }` when the
   * admission itself is refused here: its own claim (`ensureBotBinding`) or
   * this creation's judgement of the caller. Only that refusal reaches the
   * caller; a lease or permission race met anywhere else stays
   * infrastructure, which retries.
   */
  const createRoom = async (
    claim: Claim,
    admission: Principal,
  ): Promise<
    { readonly acknowledged: boolean } | { readonly refused: unknown }
  > => {
    if (admission.kind === 'bot')
      try {
        await input.store.ensureBotBinding({
          principal: admission,
          buildProjection,
        });
      } catch (error) {
        if (isRefusal(error)) return { refused: error };
        throw error;
      }
    let refused: unknown;
    const refuse = (error: unknown) => {
      refused = error;
      return error;
    };
    try {
      return await mutate(
        claim,
        { kind: 'create', identity: null, payload: {} },
        (context) => {
          if (mediaEnded(context) || admissionRevoked(context))
            throw refuse(createAppError('CONFLICT'));
          if (!admitsCreator(context, admission))
            throw refuse(createAppError('AUTHORIZATION'));
        },
      );
    } catch (error) {
      // Only that very refusal; a fault after it (rollback, abort) stays a fault.
      if (refused !== undefined && error === refused) return { refused };
      throw error;
    }
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
    (context: AuthorizeContext) => {
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
  /** Reconciles the room; the admission's own refusal, if met, is returned. */
  const reconcileRoom = async (
    claim: Claim,
    admission?: Principal,
  ): Promise<{ readonly refused: unknown } | undefined> => {
    if (!(await input.deadline(input.media.exists(claim.roomName)))) {
      if (!admission) return;
      const created = await createRoom(claim, admission);
      if ('refused' in created) return created;
      if (!created.acknowledged) return;
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
   * caller after the release and never marks the session unsafe. The
   * admission's own refusal, if the reconcile met one, is returned, not
   * thrown, so the caller can say why it was refused.
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
    let refusal: unknown;
    try {
      const state = await snapshot(claim.roundId);
      if (needsCleanup(state, claim)) {
        cleanupAttempted = true;
        absenceProof = await removeRoom(claim);
      } else {
        const refused = await reconcileRoom(claim, admission);
        if (refused) refusal = refused.refused;
        else held = await runHeld(whileHeld);
      }
    } catch (error) {
      if (!isRefusal(error)) await unsafe(claim, error);
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
    return refusal;
  };
}
