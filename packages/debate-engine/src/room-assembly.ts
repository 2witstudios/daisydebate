import type {
  RoomAssemblyState,
  RoomCommand,
  RoomConsent,
  RoomMutationOutcome,
  RoomParticipant,
  RoomRefusal,
  RoomView,
} from '@daisy/protocol';
import { seatSlotsComplete } from '@daisy/protocol';
import { resolveRoomConfiguration } from './resolve-room-configuration';

type Target = RoomParticipant & { readonly eligible: boolean };
type Edges = {
  readonly now: string;
  readonly participantId: string;
  readonly formatId: string;
  readonly target: Target | null;
};
const hostCommands = new Set<RoomCommand['type']>([
  'update-config',
  'update-details',
  'update-format',
  'assign-seat',
  'remove-seat',
  'start-prep',
  'finish-prep',
  'start-round',
  'close',
]);
const assemblyOpen = (room: RoomAssemblyState) =>
  room.status === 'assembling' || room.status === 'ready';
const complete = (room: RoomAssemblyState) =>
  Object.entries(room.rules.seats).every(([role, count]) =>
    seatSlotsComplete(
      count,
      room.participants
        .filter((p) => p.role === role)
        .map((p) => p.slot)
        .sort((a, b) => a - b),
    ),
  );
const prepFinished = (room: RoomAssemblyState, now: string) =>
  !room.executionPlan.preRoundPrep.enabled ||
  (room.prepStartedAt !== null &&
    room.prepRemainingMs !== null &&
    Date.parse(room.prepStartedAt) + room.prepRemainingMs <= Date.parse(now));
const startBlocker = (
  room: RoomAssemblyState,
  consent: RoomConsent,
  now: string,
): RoomRefusal | null => {
  if (!assemblyOpen(room)) return 'room-closed';
  if (!complete(room)) return 'incomplete-cast';
  if (room.participants.some((p) => !p.eligible)) return 'actor-ineligible';
  if (!consent.available) return 'readiness-unavailable';
  if (
    room.participants.some(
      (p) => p.kind === 'human' && !consent.readyActorIds.includes(p.actorId),
    )
  )
    return 'not-ready';
  if (!prepFinished(room, now)) return 'prep-running';
  return null;
};

/** Server projection: consumers never infer startability or consent from local device state. */
export function projectRoom(
  room: RoomAssemblyState,
  actorId: string,
  consent: RoomConsent,
  now: string,
): RoomView {
  const host = room.hostActorId === actorId;
  const open = assemblyOpen(room);
  const own = room.participants.find((p) => p.actorId === actorId);
  const finished = prepFinished(room, now);
  const blocker = startBlocker(room, consent, now);
  const { prepStartedAt, prepRemainingMs, ...base } = room;
  return {
    ...base,
    participants: room.participants.map(
      ({ consentCommandId: _fence, ...p }) => ({
        ...p,
        needsReady: p.kind === 'human',
        ready: !consent.available
          ? 'unavailable'
          : p.kind === 'bot'
            ? p.eligible
              ? 'ready'
              : 'not-ready'
            : consent.readyActorIds.includes(p.actorId)
              ? 'ready'
              : 'not-ready',
      }),
    ),
    readiness: {
      available: consent.available,
      version: room.version,
      readyActorIds: consent.readyActorIds,
    },
    prep: { startedAt: prepStartedAt, remainingMs: prepRemainingMs, finished },
    capabilities: {
      host,
      canEdit:
        host &&
        open &&
        prepStartedAt === null &&
        room.competitionType !== 'ranked',
      canClaimSeat: open && prepStartedAt === null,
      canReady: open && own?.kind === 'human' && own.eligible,
      canStartPrep:
        host &&
        open &&
        complete(room) &&
        room.executionPlan.preRoundPrep.enabled &&
        prepStartedAt === null,
      canFinishPrep:
        host &&
        open &&
        room.executionPlan.preRoundPrep.enabled &&
        prepStartedAt !== null &&
        finished,
      canStart: host && blocker === null,
    },
    startRefusal: blocker,
  };
}

/** Pure total transition. The adapter serializes the room and publishes accepted effects atomically. */
export function executeRoomCommand(
  room: RoomAssemblyState,
  actorId: string,
  command: RoomCommand,
  consent: RoomConsent,
  edges: Edges,
): RoomMutationOutcome {
  const refuse = (refusal: RoomRefusal): RoomMutationOutcome => ({
    ok: false,
    refusal,
  });
  if (command.expectedVersion !== room.version)
    return refuse('version-conflict');
  if (!assemblyOpen(room)) return refuse('room-closed');
  if (hostCommands.has(command.type) && room.hostActorId !== actorId)
    return refuse('host-required');
  let next = room;
  let consentEffect: {
    type: 'ready' | 'unready';
    actorId: string;
    commandId: string;
  } | null = null;
  let freeze = false;
  let publishDefinition = false;
  const edit = [
    'update-config',
    'update-format',
    'update-details',
    'claim-seat',
    'assign-seat',
    'leave-seat',
    'remove-seat',
  ].includes(command.type);
  if (edit && room.prepStartedAt !== null) return refuse('prep-running');
  switch (command.type) {
    case 'update-config':
    case 'update-format': {
      if (room.competitionType === 'ranked') return refuse('illegal-config');
      const definition =
        command.type === 'update-format' ? command.definition : room.definition;
      const resolved = resolveRoomConfiguration(definition, command.config);
      if (!resolved.ok) return refuse('illegal-config');
      if (room.participants.some((p) => p.slot >= resolved.rules.seats[p.role]))
        return refuse('seat-unavailable');
      publishDefinition = command.type === 'update-format';
      next = {
        ...room,
        config: command.config,
        definition,
        rules: resolved.rules,
        executionPlan: resolved.roomPlan,
        formatId: publishDefinition ? edges.formatId : room.formatId,
        formatVersion: publishDefinition ? 1 : room.formatVersion,
        prepStartedAt: null,
        prepRemainingMs: resolved.roomPlan.preRoundPrep.enabled
          ? resolved.roomPlan.preRoundPrep.durationMs
          : null,
      };
      break;
    }
    case 'update-details':
      next = {
        ...room,
        title: command.title,
        topic: command.topic,
        visibility: command.visibility,
      };
      break;
    case 'claim-seat':
    case 'assign-seat': {
      const target = edges.target;
      const targetId =
        command.type === 'claim-seat' ? actorId : command.actorId;
      if (!target || target.actorId !== targetId || !target.eligible)
        return refuse('actor-ineligible');
      if (command.type === 'claim-seat' && target.kind !== 'human')
        return refuse('actor-ineligible');
      // A host may move a human who joined; consent still belongs to that human.
      if (
        command.type === 'assign-seat' &&
        target.kind === 'human' &&
        targetId !== actorId &&
        !room.participants.some((p) => p.actorId === targetId)
      )
        return refuse('actor-ineligible');
      if (
        command.slot >= room.rules.seats[command.role] ||
        room.participants.some(
          (p) =>
            p.role === command.role &&
            p.slot === command.slot &&
            p.actorId !== targetId,
        )
      )
        return refuse('seat-unavailable');
      const existing = room.participants.find((p) => p.actorId === targetId);
      next = {
        ...room,
        participants: [
          ...room.participants.filter((p) => p.actorId !== targetId),
          {
            ...target,
            id: existing?.id ?? edges.participantId,
            role: command.role,
            slot: command.slot,
            consentCommandId: null,
          },
        ],
      };
      break;
    }
    case 'leave-seat':
    case 'remove-seat': {
      const held = room.participants.find((p) =>
        command.type === 'leave-seat'
          ? p.actorId === actorId
          : p.id === command.participantId,
      );
      if (!held) return refuse('not-seated');
      next = {
        ...room,
        participants: room.participants.filter((p) => p.id !== held.id),
      };
      break;
    }
    case 'ready':
    case 'unready': {
      const held = room.participants.find((p) => p.actorId === actorId);
      if (!held || held.kind !== 'human' || !held.eligible)
        return refuse('not-seated');
      if (command.expectedConsentVersion !== held.consentVersion)
        return refuse('consent-conflict');
      if (command.type === 'ready' && !consent.available)
        return refuse('readiness-unavailable');
      next = {
        ...room,
        participants: room.participants.map((p) =>
          p.actorId === actorId
            ? {
                ...p,
                consentCommandId: command.commandId,
                consentVersion: p.consentVersion + 1,
              }
            : p,
        ),
      };
      consentEffect = {
        type: command.type,
        actorId,
        commandId: command.commandId,
      };
      break;
    }
    case 'start-prep':
      if (!complete(room)) return refuse('incomplete-cast');
      if (
        !room.executionPlan.preRoundPrep.enabled ||
        room.prepStartedAt !== null
      )
        return refuse('prep-unavailable');
      next = { ...room, prepStartedAt: edges.now };
      break;
    case 'finish-prep':
      if (
        !room.executionPlan.preRoundPrep.enabled ||
        room.prepStartedAt === null
      )
        return refuse('prep-unavailable');
      if (!prepFinished(room, edges.now)) return refuse('prep-running');
      // Keep the original anchor: a completion acknowledgment cannot restart prep.
      break;
    case 'start-round': {
      const blocker = startBlocker(room, consent, edges.now);
      if (blocker) return refuse(blocker);
      freeze = true;
      next = { ...room, status: 'started' };
      break;
    }
    case 'close':
      next = { ...room, status: 'abandoned' };
      break;
  }
  if (edit)
    next = {
      ...next,
      version: room.version + 1,
      participants: next.participants.map((p) => ({
        ...p,
        consentCommandId: null,
      })),
    };
  if (assemblyOpen(next))
    next = { ...next, status: complete(next) ? 'ready' : 'assembling' };
  next = { ...next, changeVersion: room.changeVersion + 1 };
  return {
    ok: true,
    mutation: {
      state: next,
      consent: consentEffect,
      freeze,
      publishDefinition,
    },
  };
}
