import type { Presence } from '../../types/presence/presence';
import { presenceDotClass } from './presence-dot-class';

export type PresenceDotProps = {
  readonly presence: Presence;
};

/**
 * A presence dot is a static description of the current state, not a live
 * update: `role="status"` on every roster row would make assistive tech
 * treat each one as its own live region. `role="img"` still exposes the
 * label without that implication.
 */
export function PresenceDot({ presence }: PresenceDotProps) {
  return (
    <span
      className={presenceDotClass(presence)}
      role="img"
      aria-label={presence}
    />
  );
}
