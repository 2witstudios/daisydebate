import type { Family as Read } from '../../../features/tab/guardian';
import { PageHeader } from '../../components/page-header/page-header';
import { ReadingPage } from '../../components/reading-page/reading-page';
import { ActionButton, ActionLink } from '../action-control/action-control';
import { ListCard, ListRow } from '../list-card/list-card';

/**
 * A guardian's family: an entry that waits for them first, then each minor
 * with their account and the tournaments they are entered in.
 */
export function Family({ family }: { readonly family: Read }) {
  return (
    <ReadingPage>
      <PageHeader title="Your family" />
      {family.waiting.length === 0 ? null : (
        <ListCard label="Waiting for you">
          <ul>
            {family.waiting.map((request) => (
              <ListRow
                key={request.title}
                tone="held"
                title={request.title}
                detail={request.detail}
                trailing={<ActionButton action={request.review} />}
              />
            ))}
          </ul>
        </ListCard>
      )}
      {family.minors.map((minor) => (
        <ListCard key={minor.name} label={minor.name}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-surface px-4 py-3">
            <div className="flex min-w-0 flex-1 flex-col">
              <h2 className="text-md font-strong">{minor.name}</h2>
              <p className="text-sm text-ink-muted">{minor.detail}</p>
            </div>
            <ActionLink action={minor.account} about={minor.name} />
          </div>
          <ul>
            {minor.entries.map((entry) => (
              <ListRow
                key={entry.tournament}
                title={entry.tournament}
                detail={entry.detail}
                trailing={
                  entry.open === null ? (
                    <span className="text-sm text-ink-muted">Waiting</span>
                  ) : (
                    <ActionLink
                      action={entry.open}
                      about={`${entry.tournament}, ${minor.name}`}
                    />
                  )
                }
              />
            ))}
          </ul>
        </ListCard>
      ))}
    </ReadingPage>
  );
}
