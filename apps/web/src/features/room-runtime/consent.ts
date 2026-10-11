import type { RoomConsent } from '@daisy/protocol';
export type PreparedRoomConsent = RoomConsent & {
  readonly validUntil: string | null;
};
/** SQL time anchors the lease budget before Redis I/O, so transit and lock waits consume it. */
export function currentRoomConsent(
  consent: PreparedRoomConsent,
  now: string,
): RoomConsent {
  return consent.validUntil !== null && now >= consent.validUntil
    ? { available: consent.available, readyActorIds: [] }
    : consent;
}
