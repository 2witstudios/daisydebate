import { castSeatsBotDebater } from '@daisy/debate-engine';
import {
  isOpenRoomStatus,
  type RoomAssemblyState,
  type RoomView,
} from '@daisy/protocol';
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
    !isOpenRoomStatus(state.status) ||
    !state.participants.some((p) => p.kind === 'bot')
  )
    return null;
  // Casual judging has its own allowance; this projection names bot debates only.
  if (!castSeatsBotDebater(state)) return null;
  try {
    const status = await read(actorId);
    return status ? { kind: 'allowance', ...status } : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}
