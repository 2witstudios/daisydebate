import { notFound } from 'next/navigation';
import { idSchema } from '@daisy/protocol/primitives';
import type { SearchParams } from '../../../../features/access/decision';
import { linkTo } from '../../../../features/tab/action';
import { hostRoutes, tabRoutes } from '../../../../features/tab/routes';
import { requestHostedLeagues } from '../../../../lib/request-session';
import { requireAccess } from '../../../../lib/access';
import { PageHeader } from '../../../../ui/components/page-header/page-header';
import { ActionButton } from '../../../../ui/tab/action-control/action-control';
import {
  ListCard,
  ListHeading,
  ListRow,
} from '../../../../ui/tab/list-card/list-card';
import { storedDirectory } from '../read-tournament';

export default async function Page({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}) {
  const input = await searchParams;
  await requireAccess('/tournaments/directory', searchParams);
  const after = input.after ?? '';
  if (
    typeof after !== 'string' ||
    (after !== '' && !idSchema.safeParse(after).success)
  )
    notFound();
  const [view, leagues] = await Promise.all([
    storedDirectory(after),
    requestHostedLeagues(),
  ]);
  if (!view) notFound();
  return (
    <div className="mx-auto flex max-w-dash-column flex-col gap-5 px-4 py-6">
      <PageHeader title="Tournament directory" />
      {leagues.length > 0 ? (
        <ListCard>
          <ListHeading>Your leagues</ListHeading>
          <ul>
            {leagues.map((league) => (
              <ListRow
                key={league.id}
                title={league.name}
                trailing={
                  <ActionButton
                    size="small"
                    about={league.name}
                    action={linkTo(
                      'Open league',
                      hostRoutes.league(league.handle),
                    )}
                  />
                }
              />
            ))}
          </ul>
        </ListCard>
      ) : null}
      <ListCard>
        {view.rows.length === 0 ? (
          <p className="p-4">No tournaments to show.</p>
        ) : null}
        <ul>
          {view.rows.map((row) => (
            <ListRow
              key={row.handle}
              title={row.name}
              detail={row.status}
              trailing={
                <ActionButton
                  action={linkTo(
                    'Open tournament',
                    tabRoutes.tournament(row.handle),
                  )}
                  about={row.name}
                />
              }
            />
          ))}
        </ul>
      </ListCard>
      {view.next ? (
        <ActionButton
          action={linkTo(
            'More tournaments',
            `/tournaments/directory?after=${encodeURIComponent(view.next)}`,
          )}
        />
      ) : null}
    </div>
  );
}
