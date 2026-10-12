import { createAppError } from '@daisy/errors';
import type { RoundCommand, RoundPosition } from '@daisy/debate-engine';
import type { RoundStore } from './context';
import { aiSideOf, personSideOf, digestOf } from './context';
import type { runtimeOf } from './runtime';

export type PersonCommand =
  | { readonly type: 'start' }
  | { readonly type: 'startPrep' }
  | { readonly type: 'startSpeech' }
  | { readonly type: 'interrupt' }
  | { readonly type: 'yield'; readonly segmentIndex: number }
  | { readonly type: 'abort' };

const requireYieldSegment = (
  command: PersonCommand,
  position: RoundPosition,
): void => {
  if (
    command.type === 'yield' &&
    position.openSegment?.sequence !== command.segmentIndex
  )
    throw createAppError('CONFLICT', 'That segment is not live');
};

const actingActorOf = (
  round: Awaited<ReturnType<RoundStore['getRound']>>,
  actorId: string,
  command: RoundCommand,
  open: Pick<
    NonNullable<RoundPosition['openSegment']>,
    'side' | 'floorParticipantId'
  > | null,
): string => {
  if (!round || command.type !== 'yield') return actorId;
  if (!open) return actorId;
  if (open.floorParticipantId)
    return (
      round.participants.find((seat) => seat.id === open.floorParticipantId)
        ?.actorId ?? actorId
    );
  const botSide = aiSideOf(personSideOf(round, actorId));
  return open.side === botSide
    ? (round.participants.find((seat) => seat.role === botSide)?.actorId ??
        actorId)
    : actorId;
};

const requireBotLine = (
  lines: Awaited<ReturnType<RoundStore['listRoundUtterances']>>,
  round: NonNullable<Awaited<ReturnType<RoundStore['getRound']>>>,
  position: RoundPosition,
  acting: string,
): void => {
  const botSeat = round.participants.find((seat) => seat.actorId === acting);
  const openRow = round.segments.find(
    (segment) => segment.sequence === position.openSegment?.sequence,
  );
  if (
    !botSeat ||
    !openRow ||
    !lines.some(
      (line) =>
        line.segmentId === openRow.id &&
        line.roundParticipantId === botSeat.id &&
        line.complete,
    )
  )
    throw createAppError('CONFLICT', 'The AI has not finished its turn');
};

const requestedActorOf = (
  round: NonNullable<Awaited<ReturnType<RoundStore['getRound']>>>,
  actorId: string,
  command: PersonCommand,
  mapped: RoundCommand,
): string => {
  if (command.type !== 'yield') return actorId;
  const requested = round.rules.segments[command.segmentIndex];
  const openTarget = round.segments.some(
    (segment) =>
      segment.endedAt === null && segment.sequence === command.segmentIndex,
  );
  const floorParticipantId = openTarget
    ? (round.checkpoint.floor?.holder_participant_id ?? null)
    : null;
  return actingActorOf(
    round,
    actorId,
    mapped,
    requested ? { side: requested.side, floorParticipantId } : null,
  );
};
const commandRecord = (
  commandId: string,
  actorId: string,
  command: RoundCommand,
  botCommand: boolean,
) => ({
  commandId,
  actorId: command.type === 'start' || botCommand ? null : actorId,
  serviceId:
    command.type === 'start' ? 'ai-debate' : botCommand ? 'ai-opponent' : null,
  type: command.type,
  payloadDigest: digestOf(command),
  result: { ok: true },
});

const mappedCommand = (command: PersonCommand): RoundCommand => {
  if (command.type === 'startPrep') return { type: 'start_prep' };
  if (command.type === 'startSpeech') return { type: 'start_speech' };
  if (command.type === 'abort') return { type: 'forfeit' };
  return { type: command.type };
};

/** Snapshot facts are preloaded; every time-sensitive guard runs at the post-lock instant. */
export const roundCommandExecution = (input: {
  readonly round: NonNullable<Awaited<ReturnType<RoundStore['getRound']>>>;
  readonly runtime: ReturnType<typeof runtimeOf>;
  readonly actorId: string;
  readonly command: PersonCommand;
  readonly commandId: string;
  readonly lines: Awaited<ReturnType<RoundStore['listRoundUtterances']>>;
}) => {
  const { round, runtime, actorId, command, commandId, lines } = input;
  const mapped = mappedCommand(command);
  const attributed = requestedActorOf(round, actorId, command, mapped);
  return {
    command: commandRecord(commandId, actorId, mapped, attributed !== actorId),
    buildProjection(trustedNow: string) {
      const position = runtime.position(trustedNow);
      requireYieldSegment(command, position);
      const acting = actingActorOf(
        round,
        actorId,
        mapped,
        position.openSegment,
      );
      if (acting !== attributed)
        throw createAppError('CONFLICT', 'The command target moved on');
      if (acting !== actorId) requireBotLine(lines, round, position, acting);
      return runtime.execute({
        command: mapped,
        actorId: command.type === 'start' ? null : acting,
        now: trustedNow,
      });
    },
  };
};
