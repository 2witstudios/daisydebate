import {
  describeRating,
  ratingNote,
  seasonLine,
  type RankedStanding,
} from '../../../features/ranked/standing';
import { Badge } from '../../components/badge/badge';
import { figureClass, statusTone } from './rating-display-class';

/** The one season rating with its status, season and an unrated hint. */
export function RatingDisplay({
  standing,
}: {
  readonly standing: RankedStanding;
}) {
  const { kind, figure, status } = describeRating(standing.rating);
  const note = ratingNote(standing.rating);
  return (
    <div className="flex flex-col gap-1">
      <p className="flex flex-wrap items-center gap-3">
        <span className={figureClass(kind)}>{figure}</span>
        {/* The word Unrated is already the figure; the pill would repeat it. */}
        {kind === 'unrated' ? null : (
          <Badge tone={statusTone(kind)}>{status}</Badge>
        )}
      </p>
      {note ? <p className="text-base text-ink-muted">{note}</p> : null}
      <p className="text-base text-ink-muted">{seasonLine(standing.season)}</p>
    </div>
  );
}
