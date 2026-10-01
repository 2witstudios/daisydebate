import type { Visibility } from '../../../features/prep/library-item';
import { Avatar } from '../../components/avatar/avatar';
import { PrepIcon } from '../prep-icon/prep-icon';

/** "Private" with a lock, or "Team" with the team named for assistive tech. */
export function VisibilityMark({
  visibility,
}: {
  readonly visibility: Visibility;
}) {
  if (visibility.kind === 'private')
    return (
      <span className="inline-flex items-center gap-1 text-xs text-ink-faint">
        <PrepIcon name="lock" size={14} />
        Private
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
      <span className="sr-only">{`Shared with ${visibility.teamName}`}</span>
      <span className="inline-flex -space-x-2" aria-hidden="true">
        <Avatar name="A" size="sm" nameVisible />
        <Avatar name="B" size="sm" nameVisible />
      </span>
      Team
    </span>
  );
}
