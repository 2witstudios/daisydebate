import { createAppError, isAppError } from '@daisy/errors';
import {
  changedMediaGrants,
  type RoundMediaGrants,
} from '@daisy/debate-engine';
import { mediaEnded, seatGrants, type MediaSnapshot } from './projection';
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
    // The durable store also requires every earlier dispatched operation to have settled.
    return !(await input.deadline(input.media.exists(claim.roomName)));
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
        if (mediaEnded(context)) throw createAppError('CONFLICT');
        const seat = context.participants.find((seat) =>
          admission.kind === 'human'
            ? seat.actorId === admission.actorId && seat.kind === 'human'
            : seat.id === admission.scope.roundParticipantId &&
              seat.kind === 'bot',
        );
        if (!seat?.eligible) throw createAppError('AUTHORIZATION');
      },
    );
  };
  const knownPublishers = async (claim: Claim) => {
    const current = await input.deadline(
      input.media.publicationPermissions(claim.roomName),
    );
    const state = await snapshot(claim.roundId);
    return current.flatMap((entry) => {
      const binding = state.bindings.find(
        (binding) => binding.identity === entry.identity,
      );
      return binding
        ? [{ ...entry, participantId: binding.roundParticipantId }]
        : [];
    });
  };
  const closeStale = async (claim: Claim, known: KnownPublisher[]) => {
    const state = await snapshot(claim.roundId);
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
    const known = await knownPublishers(claim);
    if (await closeStale(claim, known)) await applyPermissions(claim, known);
  };
  return async (claim: Claim, admission?: Principal) => {
    let absenceVerified = false;
    let terminal = false;
    try {
      const state = await snapshot(claim.roundId);
      terminal = mediaEnded(state);
      if (
        claim.unsafe ||
        state.session.unsafeAt ||
        state.unresolved ||
        terminal
      )
        absenceVerified = await removeRoom(claim);
      else await reconcileRoom(claim, admission);
    } catch (error) {
      if (
        !isAppError(error) ||
        !['CONFLICT', 'AUTHORIZATION'].includes(error.code)
      )
        await unsafe(claim, error);
    } finally {
      await input.store.finishMediaReconcile({
        ...claim.fence,
        absenceVerified,
      });
    }
  };
}
