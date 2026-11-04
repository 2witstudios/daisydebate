import { createAppError, isRefusal } from '@daisy/errors';
import { MEDIA_CALL_TIMEOUT_MS, type MediaVendor } from '@daisy/media';
import {
  changedMediaGrants,
  mediaRoomFate,
  mediaRoomLost,
  mediaWindowClosed,
  type MediaObservation,
  type RoundMediaGrants,
} from '@daisy/debate-engine';
import {
  admissionRevoked,
  conversationHeldOverdue,
  mediaEnded,
  mediaRuntime,
  seatGrants,
  type MediaSnapshot,
} from './projection';
import type {
  Claim,
  Principal,
  Store,
  MediaOperationInput,
} from './operation-context';
import { OperationTimedOut } from '@daisy/observability';
import { roundStartPolicy, type MediaRoomRead } from '@daisy/protocol';
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
type KnownPublishers = {
  readonly known: KnownPublisher[];
  readonly state: MediaSnapshot;
  readonly current: Awaited<ReturnType<MediaVendor['publicationPermissions']>>;
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
/**
 * Past one vendor call's own timeout, so a live node's blip has answered. It does not
 * bound the provider: a reclaiming delete can make three calls, so a late create can still
 * leave an empty room under the old name, which closes itself by `empty_timeout`.
 */
const roomFate = mediaRoomFate(MEDIA_CALL_TIMEOUT_MS + 1_000);
/** One pass's read of the room, in the two views its readers need. */
type RoomRead = {
  readonly vendor: MediaRoomRead;
  readonly observation: MediaObservation;
  readonly publishers: KnownPublishers | null;
};
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
/** The room as this pass read it, for the platform-incident hook. */
const roomObservation = (
  listed: readonly {
    readonly identity: string;
    readonly capture: boolean;
  }[],
  state: MediaSnapshot,
  speakerHeard: boolean | null = null,
): MediaObservation => {
  const seatOf = (identity: string) =>
    state.bindings.find((binding) => binding.identity === identity);
  return {
    kind: 'room',
    captureListed: listed.some((entry) => entry.capture),
    seatsListed: state.participants
      .filter(
        (seat) =>
          seat.kind === 'human' &&
          seat.eligible &&
          (seat.role === 'affirmative' || seat.role === 'negative'),
      )
      .every((seat) =>
        listed.some(
          (entry) => seatOf(entry.identity)?.roundParticipantId === seat.id,
        ),
      ),
    speakerHeard,
  };
};

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
  readSnapshot: (roundId: string, actorId?: string) => Promise<MediaSnapshot>,
) {
  // Raised from here, not the sweep, because a dead sweep is the likely cause.
  const heldAlerted = new Set<string>();
  const snapshot = async (roundId: string, actorId?: string) => {
    const state = await readSnapshot(roundId, actorId);
    if (
      !heldAlerted.has(roundId) &&
      conversationHeldOverdue(state, input.nextId)
    ) {
      heldAlerted.add(roundId);
      input.logger.log(
        'broadcast.conversation_held_long',
        { roundId },
        'Conversation held over 30 s waiting for the audience observer',
      );
    }
    return state;
  };
  const { deferred, mutate } = createMediaMutations(input, buildProjection);
  /** Tells the incident hook what this pass saw of the room. */
  const reportToIncident = (
    state: MediaSnapshot,
    observation: MediaObservation,
  ) =>
    input.observeIncident({
      roundId: state.round.id,
      observation,
      nowMs: input.now(),
      known: {
        incident: state.round.checkpoint.incident,
        status: state.round.status,
      },
    });
  const removeRoom = async (claim: Claim) => {
    if (await input.deadline(input.media.exists(claim.roomName))) {
      await mutate(
        claim,
        { kind: 'delete', identity: null, payload: {} },
        () => undefined,
      );
    }
    // A late write after this read reaches only the room this proof retires (ADR 0110).
    const proof = await input.store.prepareMediaAbsenceProof(claim.fence);
    return (await input.deadline(input.media.exists(claim.roomName)))
      ? null
      : proof;
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
          mediaWindowClosed,
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
  const knownPublishers = async (claim: Claim): Promise<KnownPublishers> => {
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
    return { known, state, current };
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
        entry.grants.publish.every((source) => desired.publish.includes(source))
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
      if (!result.acknowledged) return false;
      entry.grants = grants;
    }
    return true;
  };
  /**
   * Reconciles the room. The admission's own refusal, if met, is returned;
   * otherwise whether every vendor write this needed was acknowledged.
   */
  /** The human seats with a microphone open now, and whether capture reads each. */
  const speakersHeard = async (
    current: readonly {
      readonly identity: string;
      readonly microphoneTrack: string | null;
    }[],
    state: MediaSnapshot,
  ) => {
    const speakers = state.bindings.flatMap((binding) => {
      const seat = state.participants.find(
        (row) => row.id === binding.roundParticipantId,
      );
      return seat?.kind === 'human' &&
        seatGrants(state, seat.id, input.nextId).publish.includes('microphone')
        ? [{ seatId: seat.id, identity: binding.identity }]
        : [];
    });
    return Promise.all(
      speakers.map(async ({ seatId, identity }) => {
        const track = current.find(
          (entry) => entry.identity === identity,
        )?.microphoneTrack;
        // A failed read is not yet heard, and the next pass asks again.
        const heard =
          Boolean(track) &&
          (await input
            .readCaptureHeard(state.round.id, track!)
            .catch(() => null)) === seatId;
        return { seatId, heard };
      }),
    );
  };
  /**
   * While a Round is held: whether capture reads the speaker's microphone in this room.
   * Null when no human holds the floor.
   */
  const speakerHeard = async (
    current: Parameters<typeof speakersHeard>[0],
    state: MediaSnapshot,
  ) => {
    if (state.round.checkpoint.incident.phase !== 'paused') return null;
    const speakers = await speakersHeard(current, state);
    return speakers.length === 0 ? null : speakers.every(({ heard }) => heard);
  };
  /**
   * Before opening the next speaker's microphone, say capture is awaited for them, so its
   * report can never arrive first. A failure here only means the clock does not wait.
   */
  const awaitCapture = async (
    current: Parameters<typeof speakersHeard>[0],
    state: MediaSnapshot,
  ) => {
    const position = mediaRuntime(state, input.nextId).position(state.now);
    if (
      position.nextSegment === null ||
      position.openSegment !== null ||
      position.countdownRemainingMs === null ||
      position.countdownRemainingMs > roundStartPolicy.microphoneLeadMs ||
      state.round.checkpoint.start_gate?.sequence ===
        position.nextSegment.sequence
    )
      return;
    const seats = (await speakersHeard(current, state))
      .filter(({ heard }) => !heard)
      .map(({ seatId }) => seatId);
    await input.awaitCapture(state.round.id, seats).catch(() => undefined);
  };
  /** Whether the room's node answers; only its own answer or its silence says it is gone. */
  const roomAnswers = (room: string) =>
    input.media.someNodeDown()
      ? input
          .deadline(input.media.roomAnswers(room))
          .catch((error) => (error instanceof OperationTimedOut ? false : null))
      : Promise.resolve(null);
  /** What this pass reads of the room before it changes anything. */
  const readRoom = async (
    claim: Claim,
    before: MediaSnapshot,
  ): Promise<RoomRead> => {
    const sid = await input.deadline(input.media.roomSid(claim.roomName));
    if (sid === null)
      return {
        vendor: { kind: 'absent' },
        observation: roomObservation([], before),
        publishers: null,
      };
    const publishers = await knownPublishers(claim);
    const { current, state } = publishers;
    const observation = roomObservation(
      current,
      state,
      await speakerHeard(current, state),
    );
    return {
      vendor: {
        kind: 'read',
        sid,
        empty: current.length === 0,
        captureListed: observation.kind === 'room' && observation.captureListed,
        answered: await roomAnswers(claim.roomName),
      },
      observation,
      publishers,
    };
  };
  const reconcileRoom = async (
    claim: Claim,
    admission: Principal | undefined,
    before: MediaSnapshot,
    read: RoomRead,
  ): Promise<
    | { readonly refused: unknown }
    | { readonly settled: boolean }
    | { readonly lost: true }
  > => {
    // Nothing is written to a room the session is about to leave.
    if (
      mediaRoomLost({
        lastOccupiedSid: before.session.roomOccupiedSid,
        sawCapture: before.session.roomSawCapture,
        seen: read.vendor,
      })
    )
      return { lost: true };
    if (read.publishers === null) {
      if (!admission) return { settled: true };
      const created = await createRoom(claim, admission);
      if ('refused' in created) return created;
      if (!created.acknowledged) return { settled: false };
    }
    const { known, state, current } =
      read.publishers ?? (await knownPublishers(claim));
    await awaitCapture(current, state);
    return {
      settled:
        (await closeStale(claim, known, state)) &&
        (await applyPermissions(claim, known)),
    };
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
   *
   * Only a domain answer changes the room: a definite refusal, or a session
   * already unsafe, ended or revoked. Any other failure (a dropped
   * connection, a timeout, an aborted transaction) is retryable. The pass is
   * deferred: the session is never marked unsafe for it, the room stays, and
   * the failure reaches the caller, which retries with its own backoff
   * (ISSUE-803).
   */
  return async (
    claim: Claim,
    admission?: Principal,
    whileHeld?: () => Promise<void>,
  ) => {
    let absenceProof: Awaited<ReturnType<typeof removeRoom>> = null;
    let cleanupAttempted = false;
    let held: { readonly error: unknown } | null = null;
    let refusal: unknown;
    let failure: { readonly error: unknown } | null = null;
    let clean = false;
    let read: RoomRead | null = null;
    let known: MediaSnapshot | null = null;
    try {
      const state = await snapshot(claim.roundId);
      known = state;
      if (needsCleanup(state, claim)) {
        cleanupAttempted = true;
        absenceProof = await removeRoom(claim);
        clean = absenceProof !== null;
      } else {
        read = await readRoom(claim, state);
        const room = await reconcileRoom(claim, admission, state, read);
        if ('refused' in room) refusal = room.refused;
        else if ('settled' in room) {
          clean = room.settled;
          held = await runHeld(whileHeld);
        }
      }
    } catch (error) {
      if (!isRefusal(error)) failure = { error };
    } finally {
      try {
        const state = await snapshot(claim.roundId);
        if (!cleanupAttempted && uncertain(state)) {
          absenceProof = await removeRoom(claim);
          clean &&= absenceProof !== null;
        }
      } catch (error) {
        clean = false;
        failure ??= { error };
      }
      const finished = await input.store.finishMediaReconcile({
        mediaWindowClosed,
        ...claim.fence,
        absenceProof,
        clean,
        roomFate,
        seen: read?.vendor ?? null,
      });
      // Best effort, outside the journal: no token names this room any more, and a create
      // inside the delete clears what a dead node left listed in LiveKit's Redis.
      if (finished.fate.kind === 'rotate' && finished.fate.cause === 'lost')
        void input.media.deleteRoom(claim.roomName).catch(() => undefined);
      if (finished.fate.kind === 'rotate')
        input.logger.log(
          'round.media.room_retired',
          { roundId: claim.roundId, cause: finished.fate.cause },
          'The session left its room for a fresh one',
        );
      if (known)
        await reportToIncident(
          known,
          // Only a real failure before any read means the vendor was not reached.
          read?.observation ?? {
            kind: failure && !cleanupAttempted ? 'unreachable' : 'unread',
          },
        );
    }
    if (failure) {
      deferred(failure.error);
      throw failure.error;
    }
    if (held) throw held.error;
    return refusal;
  };
}
