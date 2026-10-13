import { Fragment } from 'react';
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

/** What the round keeps: live while the speeches run, kept once they end. */
function keptRows(round: RoundSnapshot) {
  const after = round.phase === 'judging';
  return [
    {
      term: 'Recording',
      value: round.recording ? (after ? 'Saved' : 'On') : 'Off',
      live: round.recording && !after,
    },
    {
      term: 'Transcript',
      value: round.transcribing ? (after ? 'Complete' : 'Live') : 'Off',
      live: false,
    },
    ...(after && round.recording
      ? [{ term: 'This room now', value: 'Not recorded', live: false }]
      : []),
  ];
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
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">
                        {personName(round, person)}
                      </span>
                      {role === 'judge' && round.phase === 'judging' ? (
                        <span className="text-xs text-ink-muted">
                          Writing ballot
                        </span>
                      ) : null}
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
        {keptRows(round).map((row) => (
          <Fragment key={row.term}>
            <dt className="text-ink-muted">{row.term}</dt>
            <dd className={row.live ? 'text-live' : undefined}>{row.value}</dd>
          </Fragment>
        ))}
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
