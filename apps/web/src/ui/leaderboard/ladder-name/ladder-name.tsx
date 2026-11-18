import type { LadderName as LadderNameView } from '../../../features/leaderboard/ladder-name';
import { LadderBadge } from '../../ladder-badge/ladder-badge';

/** The chosen ladder, named above its table: badge, then who is on it. */
export function LadderName({ name }: { readonly name: LadderNameView }) {
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
      <LadderBadge ladder={name.ladder} />
      {` ${name.audience}`}
    </p>
  );
}
