import { createAppError } from '@daisy/errors';
import {
  oneOnOneDefinition,
  practiceRoomConfig,
} from '@daisy/db/reference-formats';
import { resolveRoomConfiguration } from '@daisy/debate-engine';
import type { MediaSnapshot } from './projection';
import type { MediaOperationInput, Store } from './operation-context';
import {
  createMediaVendor,
  type Grants,
  type Vendor,
} from './media-vendor.test-support';

/** Deterministic 24-character identifiers the real media adapter accepts. */
export const fixedId = (label: string) =>
  label
    .replace(/[^a-z0-9]/g, '')
    .padEnd(24, '0')
    .slice(0, 24);

const compiled = resolveRoomConfiguration(
  oneOnOneDefinition,
  practiceRoomConfig,
);
if (!compiled.ok) throw new Error('Canonical rules fixture refused');
const rules = compiled.rules;
const roomName = fixedId('room');
const sessionId = fixedId('session');
const roundId = fixedId('round');
const seats = [
  {
    id: fixedId('seataff'),
    actorId: fixedId('actoraff'),
    role: 'affirmative',
    slot: 0,
  },
  {
    id: fixedId('seatneg'),
    actorId: fixedId('actorneg'),
    role: 'negative',
    slot: 0,
  },
  {
    id: fixedId('seatjudge'),
    actorId: fixedId('actorjudge'),
    role: 'judge',
    slot: 0,
  },
] as const;

/**
 * One Round's durable media facts and one self-hosted LiveKit room, held in
 * memory behind the real media adapter. Vendor calls are journaled in order.
 */
export function createMediaWorld(
  options: {
    readonly status?: 'scheduled' | 'active' | 'completed' | 'abandoned';
    readonly busyClaims?: number;
    /** Another worker claims the reconcile lease the instant each of ours finishes, as recovery does on a busy deployment. */
    readonly reclaimedAfterFinish?: boolean;
  } = {},
) {
  const journal: string[] = [];
  const reported: unknown[] = [];
  const failures = new Map<Vendor, number>();
  const rooms = new Set<string>();
  const connected = new Map<string, Grants>();
  const eligible = new Map<string, boolean>(seats.map((s) => [s.id, true]));
  const bindings: { roundParticipantId: string; identity: string }[] = [];
  const pending = new Set<string>();
  let status = options.status ?? 'scheduled';
  let busy = options.busyClaims ?? 0;
  let leaseOwner: string | null = null;
  let reconciles = 0;
  let unsafeAt: string | null = null,
    endedAt: string | null = null,
    requested = 0,
    running = 0,
    served = 0,
    epoch = 0,
    mutations = 0,
    ids = 0;
  const now = '2026-10-22T00:00:00.000Z';
  const nextId = () => fixedId(`id${(ids += 1)}`);
  const fail = async (call: Vendor) => {
    const left = failures.get(call) ?? 0;
    if (left <= 0) return;
    failures.set(call, left - 1);
    throw new Error(`${call} unavailable`);
  };
  const snapshot = (actorId?: string): MediaSnapshot => {
    const participants = seats.map((seat) => ({
      ...seat,
      kind: 'human' as const,
      eligible: eligible.get(seat.id)!,
    }));
    const caller =
      actorId === undefined
        ? null
        : (participants.find((s) => s.actorId === actorId && s.eligible) ??
          null);
    if (actorId !== undefined && !caller) throw createAppError('AUTHORIZATION');
    return {
      session: {
        id: sessionId,
        roundId,
        roomName,
        unsafeAt: unsafeAt && new Date(unsafeAt),
        endedAt: endedAt && new Date(endedAt),
      },
      round: {
        id: roundId,
        status,
        currentStage: null,
        startedAt: status === 'scheduled' ? null : now,
        completedAt: null,
        outcome: null,
        rules,
        participants: seats.map((seat) => ({ ...seat })),
        checkpoint: {
          version: 1,
          prep_consumed_ms: { affirmative: 0, negative: 0 },
          active_prep: null,
          floor: null,
        },
        segments: [],
      },
      participants,
      caller,
      bindings: bindings.map((binding) => ({ ...binding, roomName })),
      now,
      finalSegmentEndedAt: null,
      unresolved: pending.size > 0,
      reconciling: false,
    } as unknown as MediaSnapshot;
  };
  const binding = (participantId: string) => {
    let found = bindings.find((b) => b.roundParticipantId === participantId);
    if (!found) {
      found = { roundParticipantId: participantId, identity: nextId() };
      bindings.push(found);
    }
    return { sessionId, roomName, identity: found.identity };
  };
  const store = {
    readMediaSession: async (input: { actorId?: string }) =>
      snapshot(input.actorId),
    requestMediaReconcile: async () => ({
      sessionId,
      version: (requested += 1),
    }),
    mediaReconcileProgress: async () => ({ servedVersion: served }),
    claimMediaReconcile: async (request: { owner: string }) => {
      if (busy > 0) {
        busy -= 1;
        return { kind: 'busy' as const };
      }
      running = requested;
      leaseOwner = request.owner;
      reconciles += 1;
      return {
        kind: 'claimed' as const,
        fence: { sessionId, owner: request.owner, epoch: (epoch += 1) },
        roundId,
        roomName,
        unsafe: unsafeAt !== null,
        runningVersion: running,
      };
    },
    beginMediaMutation: async (request: {
      intent: { kind: string; identity: string | null };
      authorize: (context: unknown) => void;
    }) => {
      const participantId =
        bindings.find((b) => b.identity === request.intent.identity)
          ?.roundParticipantId ?? null;
      request.authorize({ ...snapshot(), participantId });
      const id = nextId();
      pending.add(id);
      mutations += 1;
      return id;
    },
    settleMediaMutation: async (id: string) => {
      pending.delete(id);
    },
    markMediaUnsafe: async () => {
      unsafeAt ??= now;
    },
    prepareMediaAbsenceProof: async (fence: object) =>
      pending.size ? null : { ...fence, settledMutationCount: mutations },
    finishMediaReconcile: async (request: {
      absenceProof: { settledMutationCount: number } | null;
    }) => {
      served = running;
      leaseOwner = options.reclaimedAfterFinish ? 'recovery-worker' : null;
      const cleaned =
        pending.size === 0 &&
        request.absenceProof?.settledMutationCount === mutations;
      const terminal = ['completed', 'abandoned'].includes(status);
      if (cleaned) {
        unsafeAt = null;
        if (terminal) endedAt ??= now;
      }
    },
    ensureBinding: async (input: { actorId: string }) => {
      if (['completed', 'abandoned'].includes(status))
        throw createAppError('CONFLICT', 'Round media has ended');
      const seat = snapshot(input.actorId).caller!;
      return binding(seat.id);
    },
    issueMediaToken: async <T>(input: {
      principal: { kind: 'human'; actorId: string };
      reconcileOwner?: string;
      sign: (context: unknown) => Promise<T>;
    }) => {
      const state = snapshot(input.principal.actorId);
      // As the store: a live lease refuses unless the caller holds it.
      const foreignLease =
        leaseOwner !== null && leaseOwner !== input.reconcileOwner;
      if (
        state.session.endedAt ||
        state.session.unsafeAt ||
        state.unresolved ||
        foreignLease
      )
        throw createAppError('INFRASTRUCTURE', 'Media recovery is unresolved');
      const participantId = state.caller!.id;
      return input.sign({
        ...state,
        participantId,
        binding: {
          ...binding(participantId),
          roundParticipantId: participantId,
        },
      });
    },
    activeMediaSessions: async () => (endedAt ? [] : [{ roundId }]),
  } as unknown as Store;
  const media = createMediaVendor({ journal, rooms, connected, fail });
  const input: MediaOperationInput = {
    store,
    media,
    publicUrl: 'wss://media.daisy.invalid',
    workerUrl: 'ws://worker.daisy.invalid',
    nextId,
    reporter: { capture: (error: unknown) => void reported.push(error) },
    logger: {
      log: () => undefined,
    } as unknown as MediaOperationInput['logger'],
    deadline: (work) => work,
    wait: async () => undefined,
  } as MediaOperationInput;
  return {
    input,
    roundId,
    roomName,
    seats,
    journal,
    reported,
    rooms,
    connected,
    /** Fail the next `times` calls of one vendor operation. */
    fail: (call: Vendor, times = 1) => void failures.set(call, times),
    /** A participant that joined with its minted identity and grants. */
    connect: (participantId: string, grants: Grants) =>
      void connected.set(binding(participantId).identity, grants),
    identity: (participantId: string) => binding(participantId).identity,
    revoke: (participantId: string, value = false) =>
      void eligible.set(participantId, value),
    end: () => {
      status = 'completed';
    },
    /** Another reconcile holds the session for our next `times` claims. */
    holdClaims: (times: number) => {
      busy = times;
    },
    /** Reconcile leases claimed so far. */
    reconciles: () => reconciles,
    state: () => ({
      unsafe: unsafeAt !== null,
      ended: endedAt !== null,
      pending: pending.size,
      served,
    }),
    snapshot,
  };
}
