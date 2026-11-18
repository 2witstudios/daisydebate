import { rankedRoomLadder } from '../../../features/play/ladder-division-words';
import { ladderLabel } from '../../../features/ratings/ladder-labels';
import { Icon } from '../../components/icon/icon';
import { SeatedLadderBadge } from '../../ladder-badge/ladder-badge';

/**
 * What choosing Ranked means for the ladder (owner decision 79, ADR 0147):
 * the debaters who sit set it, ages that mix play casual, and anyone judges.
 * It is the consequence of the choice being made, so the form says it.
 */
export function RankedLadderNote() {
  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-lg bg-hue-plum-soft px-4 py-3 text-sm"
    >
      <Icon name="info" size={18} className="mt-1 shrink-0 text-hue-plum" />
      <div className="flex min-w-0 flex-col gap-1">
        <strong className="font-strong">
          The ladder is set by who sits down.
        </strong>
        <span>
          If every debater is 18 or over, the Round is ranked on{' '}
          <SeatedLadderBadge seated="open" />. If every debater is under 18, it is
          ranked on <SeatedLadderBadge seated="youth" />.
        </span>
        <span>
          If the debaters mix ages, the Round plays casual and no ratings
          change. You’ll see this before you start.
        </span>
        <span className="text-ink-muted">
          Anyone can judge, whatever the ladder.
        </span>
      </div>
    </div>
  );
}

/** The ladder rows of a ranked Room's summary: who sits sets it. */
export const rankedLadderRows: readonly (readonly [string, string])[] = [
  ['Ladder', 'Set by the debaters'],
  ['All under 18', ladderLabel(rankedRoomLadder('youth'))],
  ['All 18 and over', ladderLabel(rankedRoomLadder('open'))],
  ['Ages mix', 'Casual'],
];

/** The "Your room" summary's ladder block for a ranked Room. */
export function RankedLadderSummary() {
  return (
    <dl
      aria-label="Ladder"
      className="flex flex-col gap-2 border-b border-border pb-4 text-sm"
    >
      {rankedLadderRows.map(([term, value], index) => (
        <div key={term} className="flex justify-between gap-3">
          <dt className="text-ink-muted">{term}</dt>
          <dd className={index === 0 ? 'font-strong' : undefined}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
