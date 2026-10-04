import { Icon } from '../icon/icon';

/** Stands in for a debater's rating and history while the viewer judges them. */
export function HiddenWhileJudging() {
  return (
    <p className="flex items-start gap-3 rounded-md bg-surface-overlay p-4 text-base text-ink-muted">
      <Icon name="eye" size={20} />
      Hidden while you judge
    </p>
  );
}
