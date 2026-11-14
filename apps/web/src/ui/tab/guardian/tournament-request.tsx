import Link from 'next/link';
import type { TournamentRequest as Read } from '../../../features/tab/guardian';
import { PageHeader } from '../../components/page-header/page-header';
import { ReadingPage } from '../../components/reading-page/reading-page';
import { ActionButton } from '../action-control/action-control';
import { ListCard, ListHeading, ListRow } from '../list-card/list-card';

/**
 * A guardian's one decision about a tournament outside the lobbies they
 * allow: the same act as allowing any lobby, for this tournament only.
 */
export function TournamentRequest({ request }: { readonly request: Read }) {
  return (
    <ReadingPage>
      <Link
        href={request.back.href}
        className="self-start font-strong text-ink underline"
      >
        {request.back.label}
      </Link>
      <PageHeader title={request.title} lede={request.lede} />
      <ListCard label="The tournament">
        <ul>
          {request.facts.map((fact) => (
            <ListRow key={fact.title} title={fact.title} detail={fact.detail} />
          ))}
        </ul>
      </ListCard>
      <ListCard>
        <ListHeading>If you allow it</ListHeading>
        <div className="flex flex-col gap-2 px-4 py-3">
          <p>{request.consequence.allows}</p>
          <p className="text-sm text-ink-muted">{request.consequence.keeps}</p>
        </div>
      </ListCard>
      <div className="flex flex-col gap-2">
        <ActionButton action={request.allow} />
        <ActionButton action={request.decline} />
        <p className="text-center text-sm text-ink-muted">
          {request.declineNote}
        </p>
      </div>
    </ReadingPage>
  );
}
