import type { Ladder, RatingDivision } from '@daisy/protocol';
import { ladderLabel } from '../../features/ratings/ladder-labels';
import { Badge } from '../components/badge/badge';
import type { BadgeTone } from '../components/badge/badge-class';

/**
 * The one ladder badge (ADR 0147), for the surfaces that still name a ladder
 * outside a lobby (Watch, Recordings, league lobbies): each division in its
 * colour, Youth the plum area hue, Open the accent green. Inside a lobby
 * nothing names a division (ADR 0156).
 */
const tones: Readonly<Record<RatingDivision, BadgeTone>> = {
  youth: 'plum',
  open: 'accent',
};

/** A ladder's name in its division's colour: "Youth – Freestyle". */
export function LadderBadge({ ladder }: { readonly ladder: Ladder }) {
  return <Badge tone={tones[ladder.division]}>{ladderLabel(ladder)}</Badge>;
}
