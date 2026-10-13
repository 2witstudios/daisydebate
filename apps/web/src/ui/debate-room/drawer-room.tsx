import type { RoundPerson, RoundSnapshot } from './round';

const groups: readonly {
  readonly role: RoundPerson['role'];
  readonly title: string;
}[] = [
  { role: 'aff', title: 'Affirmative' },
  { role: 'neg', title: 'Negative' },
  { role: 'judge', title: 'Judge' },
];

const ratingOf = (round: RoundSnapshot, id: string) =>
  [round.self, round.opponent].find((d) => d.id === id)?.rating ?? null;

/** A seat's line: a human judge stays anonymous until the ballots arrive. */
function personName(round: RoundSnapshot, person: RoundPerson) {
  if (person.role === 'judge') return person.bot ? 'AI judge' : 'Judge';
  if (person.id === round.self.id) return `${person.name} (you)`;
  return person.name;
}

const stakesLabel = (stakes: NonNullable<RoundSnapshot['stakes']>) =>
  `+${stakes.win} / −${stakes.loss}`;

/** Who is in the round, and what the round is keeping. */
export function DrawerRoom({ round }: { readonly round: RoundSnapshot }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      {groups.map(({ role, title }) => {
        const people = round.people.filter((p) => p.role === role);
        if (people.length === 0) return null;
        return (
          <section key={role} aria-label={title} className="flex flex-col">
            <h2 className="px-2 pb-1 text-2xs font-strong tracking-wider text-ink-muted uppercase">
              {title}
            </h2>
            <ul className="flex flex-col">
              {people.map((person) => {
                const rating =
                  role === 'judge' ? null : ratingOf(round, person.id);
                return (
                  <li
                    key={person.id}
                    className="flex min-h-room-target items-center gap-2 px-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {personName(round, person)}
                    </span>
                    {person.bot && role !== 'judge' ? (
                      <span className="text-xs text-ink-muted">AI</span>
                    ) : null}
                    {rating === null ? null : (
                      <span className="text-xs text-ink-muted tabular-nums">
                        {rating}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border px-2 pt-4 text-sm">
        <dt className="text-ink-muted">Recording</dt>
        <dd className={round.recording ? 'text-live' : undefined}>
          {round.recording ? 'On' : 'Off'}
        </dd>
        <dt className="text-ink-muted">Transcript</dt>
        <dd>{round.transcribing ? 'Live' : 'Off'}</dd>
        {round.stakes ? (
          <>
            <dt className="text-ink-muted">Stakes</dt>
            <dd className="tabular-nums">{stakesLabel(round.stakes)}</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}
