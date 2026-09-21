import type { Presence } from '../../types/presence/presence';
import { presenceDotClass } from './presence-dot-class';

export type PresenceDotProps = {
  readonly presence: Presence;
};

export function PresenceDot({ presence }: PresenceDotProps) {
  return (
    <span
      className={presenceDotClass(presence)}
      role="status"
      aria-label={presence}
    />
  );
}
