import { Icon } from '../../components/icon/icon';

export type Participant = {
  readonly name: string;
  readonly note: string;
  readonly done: boolean;
};

/** Who has accepted: a check for each player who has, a dashed ring if not. */
export function MatchParticipants({
  participants,
}: {
  readonly participants: readonly Participant[];
}) {
  return (
    <ul className="overflow-hidden rounded-xl border border-border bg-surface shadow-1">
      {participants.map(({ name, note, done }) => (
        <li
          key={name}
          className="flex min-h-12 items-center gap-3 border-t border-border px-5 py-3 first:border-t-0"
        >
          {done ? (
            <span className="inline-flex size-8 items-center justify-center rounded-full bg-accent text-accent-ink">
              <Icon name="check" size={16} />
            </span>
          ) : (
            <span className="inline-block size-8 rounded-full border-2 border-dashed border-border-strong" />
          )}
          <span className="flex grow flex-col">
            <span className="font-strong">{name}</span>
            <span className="text-sm text-ink-muted">{note}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
