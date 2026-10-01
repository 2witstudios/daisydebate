import { Avatar } from '../../components/avatar/avatar';

export type PersonProps = {
  readonly handle: string;
  /** Shown after the handle when given; "Provisional" for no rating. */
  readonly rating?: number | null;
  readonly you?: boolean;
};

/** A debater: avatar, public handle, optional rating and a "You" chip. */
export function Person({ handle, rating, you = false }: PersonProps) {
  return (
    <span className="inline-flex min-w-0 items-center gap-3">
      <Avatar name={handle} size="sm" nameVisible />
      <span className="truncate font-strong text-ink">{`@${handle}`}</span>
      {you ? (
        <span className="rounded-badge bg-accent-soft px-badge-x py-badge-y text-badge font-heavy tracking-wider text-accent uppercase">
          You
        </span>
      ) : null}
      {rating === undefined ? null : (
        <span className="text-sm text-ink-faint tabular-nums">
          {rating === null ? 'Provisional' : rating}
        </span>
      )}
    </span>
  );
}
