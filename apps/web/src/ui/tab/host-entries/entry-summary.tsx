import { sampleAction } from '../../../features/tab/action';
import { ActionButton } from '../action-control/action-control';
import type { HostEntries } from '../../../features/tab/entries';
import { SearchableGroups } from '../searchable-groups/searchable-groups';
import { ListCard, ListHeading, ListRow } from '../list-card/list-card';

/** Each adult's roster opens in place; long categories start collapsed. */
export function EntrySummary({ entries }: { readonly entries: HostEntries }) {
  const schools = entries.groups.filter((group) => group.kind === 'school');
  const families = entries.groups.filter((group) => group.kind === 'guardian');
  const alone = entries.groups.filter((group) => group.kind === 'self');
  const notAnswered = entries.groups
    .flatMap((group) => group.entries)
    .filter((entry) => entry.status === 'not_answered').length;
  return (
    <>
      <ListCard>
        <ListHeading>Needs you</ListHeading>
        <ul>
          <ListRow
            title={`${notAnswered} entries haven't answered`}
            trailing={
              <ActionButton
                action={sampleAction(`Remind the ${notAnswered}`)}
                size="small"
              />
            }
          />
          <ListRow
            title={`${schools.filter((group) => group.short).length} schools owe judges`}
            detail={schools
              .filter((group) => group.short)
              .map((group) => group.name)
              .join(' · ')}
            trailing={
              <ActionButton
                action={sampleAction('Remind coaches')}
                size="small"
              />
            }
          />
        </ul>
      </ListCard>
      <SearchableGroups
        label="Find an entry, school or adult"
        statuses={[
          { id: 'not_answered', label: 'Not answered' },
          { id: 'short', label: 'Owing a judge' },
        ]}
        groups={[
          {
            heading: 'Schools',
            limit: 8,
            rows: schools.map((group) => ({
              content: (
                <ul>
                  {group.entries.map((entry) => (
                    <ListRow
                      key={entry.name}
                      title={entry.name}
                      detail={entry.facts}
                    />
                  ))}
                </ul>
              ),
              statuses: [
                ...(group.short ? ['short'] : []),
                ...(group.entries.some(
                  (entry) => entry.status === 'not_answered',
                )
                  ? ['not_answered']
                  : []),
              ],
              title: group.name,
              detail: `${group.enteredBy} · ${group.summary}`,
              words: group.entries.map(
                (entry) => `${entry.name} ${entry.facts}`,
              ),
              status: group.short
                ? 'short'
                : group.entries.some((entry) => entry.status === 'not_answered')
                  ? 'not_answered'
                  : 'accepted',
              action: null,
            })),
          },
          {
            heading: 'Families',
            limit: 2,
            rows: families.map((group) => ({
              content: (
                <ul>
                  {group.entries.map((entry) => (
                    <ListRow
                      key={entry.name}
                      title={entry.name}
                      detail={entry.facts}
                    />
                  ))}
                </ul>
              ),
              title: group.name,
              detail: group.summary,
              words: group.entries.map((entry) => entry.name),
              action: null,
            })),
          },
          {
            heading: 'Entered alone',
            limit: 0,
            rows: alone.flatMap((group) =>
              group.entries.map((entry) => ({
                title: entry.name,
                detail: entry.facts,
                action: null,
              })),
            ),
          },
        ]}
      />
    </>
  );
}
