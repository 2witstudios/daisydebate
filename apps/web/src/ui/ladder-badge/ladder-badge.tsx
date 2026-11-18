import type { Ladder, RatingDivision, SeatedDivision } from '@daisy/protocol';
import type { ReactNode } from 'react';
import { seatedLadderLabel } from '../../features/play/ladder-division-words';
import {
  divisionLabels,
  ladderLabel,
} from '../../features/ratings/ladder-labels';
import { Badge } from '../components/badge/badge';
import type { BadgeTone } from '../components/badge/badge-class';

/**
 * The one ladder badge (ADR 0147): each division in its colour — Youth the
 * plum area hue, Open the accent green. A ranked Room whose ladder no debater
 * has set yet is neutral; one whose debaters mix ladders plays casual, in gold.
 */
const tones: Readonly<Record<SeatedDivision, BadgeTone>> = {
  youth: 'plum',
  open: 'accent',
  unset: 'neutral',
  mixed: 'gold',
};

/** A division's tone, for a badge that says something else on its ladder. */
export const divisionTone = (division: RatingDivision): BadgeTone =>
  tones[division];

/** A ladder's name in its division's colour: "Youth – Freestyle". */
export function LadderBadge({ ladder }: { readonly ladder: Ladder }) {
  return <Badge tone={tones[ladder.division]}>{ladderLabel(ladder)}</Badge>;
}

/** A ranked Room's ladder as its seats set it, unset or mixed included. */
export function SeatedLadderBadge({
  seated,
}: {
  readonly seated: SeatedDivision;
}) {
  return <Badge tone={tones[seated]}>{seatedLadderLabel(seated)}</Badge>;
}

/** A seated debater's own ladder, by its division alone: "Youth". */
export function DivisionBadge({
  division,
}: {
  readonly division: RatingDivision;
}) {
  return <Badge tone={tones[division]}>{divisionLabels[division]}</Badge>;
}

/** Any words on a ladder's colour, such as "Your ladder". */
export function DivisionToneBadge({
  division,
  children,
}: {
  readonly division: RatingDivision;
  readonly children: ReactNode;
}) {
  return <Badge tone={tones[division]}>{children}</Badge>;
}
