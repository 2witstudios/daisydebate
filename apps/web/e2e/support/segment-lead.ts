import { leadSeatOf, type SpeakRights } from '@daisy/protocol/format-seating';
import { sideOfSeat, type SideKey } from '@daisy/protocol/seats';

/** The side a segment is scheduled to, or null for an unsided lead or an open floor. */
export const leadSideOf = (speak: SpeakRights): SideKey | null => {
  const lead = leadSeatOf(speak);
  return lead ? sideOfSeat(lead) : null;
};
