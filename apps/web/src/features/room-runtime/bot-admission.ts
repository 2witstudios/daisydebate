import { castSpendsAiRound } from '@daisy/debate-engine';
import type { RoomAssemblyState, RoomView } from '@daisy/protocol';
import type { BotAdmissionStatus } from '@daisy/db/round-bot-admission';
/** Economic metadata is scoped to the current host; it grants no competitive authority. */
export async function roomBotAdmission(
  state: RoomAssemblyState,
  actorId: string,
  read: (actorId: string) => Promise<BotAdmissionStatus | null>,
): Promise<RoomView['botAdmission']> {
  if (
    state.hostActorId !== actorId ||
    state.competitionType === 'ranked' ||
    state.status === 'started' ||
    state.status === 'abandoned' ||
    !state.participants.some((p) => p.kind === 'bot')
  )
    return null;
  // The same pure cast rule the freeze applies (DEC-186): an AI judge is free.
  if (!castSpendsAiRound(state)) return { kind: 'free' };
  try {
    const status = await read(actorId);
    return status ? { kind: 'allowance', ...status } : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}
