import type { RoundRecord } from '@daisy/protocol';
import type { RoundRoomAuthority } from './round-room-authority';

/** A completed event Round is not itself a release of its decision. */
export const roundOutcomeForAudience = <T extends RoundRecord>(
  view: T,
  owner: RoundRoomAuthority,
  decisionVisible: boolean,
): T =>
  owner.kind === 'ordinary' ||
  (owner.kind === 'event' && owner.direction !== null && decisionVisible)
    ? view
    : { ...view, outcome: null, panelRuling: null };
