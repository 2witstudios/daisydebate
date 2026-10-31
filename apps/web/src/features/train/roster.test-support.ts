import type { RoomCastChoice } from '@daisy/protocol';

/** A bot debater as the cast read returns it, with a stable short label. */
export const debater = (
  actorId: string,
  fields: Partial<RoomCastChoice> = {},
): RoomCastChoice => ({
  actorId,
  label: `Bot ${actorId.slice(0, 4)}`,
  kind: 'bot',
  seatRole: 'debater',
  eligible: true,
  ...fields,
});

/** The AI judge as the cast read returns it. */
export const judge = (
  fields: Partial<RoomCastChoice> = {},
): RoomCastChoice => ({
  actorId: 'judge-actor-id-000000',
  label: 'The Panel',
  kind: 'bot',
  seatRole: 'judge',
  eligible: true,
  ...fields,
});
